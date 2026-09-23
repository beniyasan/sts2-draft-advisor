using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using DraftAdvisor.Advisor;
using DraftAdvisor.Game;
using MegaCrit.Sts2.Core.Logging;

namespace DraftAdvisor.IPC;

/// <summary>
/// Best-effort local bridge to the companion Electron overlay. The game never
/// waits for the overlay: publishes only stash the latest state and a
/// background flush writes it to the pipe, so a stalled or absent client can
/// never block a game thread. All pipe failures are deliberately fail-soft.
/// </summary>
public static class OverlayBridge
{
    public const string PipeName = "DraftAdvisor.v1";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
    };
    private static readonly object Gate = new();
    private static OverlayGameState? _latest;
    private static NamedPipeServerStream? _client;
    private static StreamWriter? _writer;
    private static bool _started;
    private static bool _dirty;
    private static bool _flushRunning;

    public static void Start()
    {
        lock (Gate)
        {
            if (_started) return;
            _started = true;
        }
        _ = Task.Run(AcceptLoop);
    }

    public static void PublishState(string screenKind, RunInspector.Snapshot snapshot,
        IReadOnlyList<OfferAdvice> offers)
    {
        var state = OverlayStateFactory.Create(screenKind, snapshot, offers);
        lock (Gate)
            _latest = state;
        KickFlush();
    }

    /// <summary>Mark the latest state dirty and ensure a flush task is draining it.</summary>
    private static void KickFlush()
    {
        lock (Gate)
        {
            _dirty = true;
            if (_flushRunning) return;
            _flushRunning = true;
        }
        _ = Task.Run(FlushLoop);
    }

    /// <summary>Latest-wins writer loop; only one instance ever runs at a time.</summary>
    private static async Task FlushLoop()
    {
        while (true)
        {
            OverlayGameState? state;
            StreamWriter? writer;
            lock (Gate)
            {
                if (!_dirty)
                {
                    _flushRunning = false;
                    return;
                }
                _dirty = false;
                state = _latest;
                writer = _writer;
            }
            if (state == null || writer == null) continue;
            try
            {
                var payload = JsonSerializer.Serialize(state, JsonOptions);
                await writer.WriteLineAsync(payload).ConfigureAwait(false);
                await writer.FlushAsync().ConfigureAwait(false);
            }
            catch
            {
                lock (Gate) DisconnectLocked();
            }
        }
    }

    private static async Task AcceptLoop()
    {
        while (true)
        {
            NamedPipeServerStream? server = null;
            try
            {
                server = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await server.WaitForConnectionAsync().ConfigureAwait(false);
                lock (Gate)
                {
                    _client = server;
                    _writer = new StreamWriter(server, new UTF8Encoding(false), 1024, leaveOpen: true)
                    { AutoFlush = true };
                }
                KickFlush();
                await ReadClientAsync(server).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                Log.Error($"[DraftAdvisor] overlay pipe stopped: {ex.Message}");
                // Keep the bridge alive but never spin on a persistent failure.
                await Task.Delay(1000).ConfigureAwait(false);
            }
            finally
            {
                lock (Gate) DisconnectLocked();
                try { server?.Dispose(); } catch { }
            }
        }
    }

    private static async Task ReadClientAsync(NamedPipeServerStream server)
    {
        using var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: true,
            bufferSize: 1024, leaveOpen: true);
        while (server.IsConnected)
        {
            var line = await reader.ReadLineAsync().ConfigureAwait(false);
            if (line == null) break;
            try
            {
                var message = JsonSerializer.Deserialize<OverlayPipeMessage>(line, JsonOptions);
                if (message?.Type == "request_state")
                    KickFlush();
            }
            catch (JsonException) { }
        }
    }

    private static void DisconnectLocked()
    {
        _writer = null;
        try { _client?.Disconnect(); } catch { }
        _client = null;
    }
}
