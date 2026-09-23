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
    private static readonly Queue<string> _outbox = new();
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

    /// <summary>Ask the overlay to toggle its window (fired by the in-game hotkey).</summary>
    public static void SendToggle() => SendMessage(new OverlayPipeMessage { Type = "toggle_window" });

    /// <summary>Queue a one-off JSON line for the overlay. Dropped when no client is connected.</summary>
    private static void SendMessage(object message)
    {
        var payload = JsonSerializer.Serialize(message, JsonOptions);
        lock (Gate) _outbox.Enqueue(payload);
        KickFlush();
    }

    /// <summary>Mark pending work and ensure a flush task is draining it.</summary>
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

    /// <summary>Single writer loop: drains queued messages first, then the latest state.</summary>
    private static async Task FlushLoop()
    {
        while (true)
        {
            string? payload;
            StreamWriter? writer;
            lock (Gate)
            {
                if (_outbox.Count == 0 && !_dirty)
                {
                    _flushRunning = false;
                    return;
                }
                if (_outbox.Count > 0)
                {
                    payload = _outbox.Dequeue();
                }
                else
                {
                    _dirty = false;
                    payload = _latest == null ? null : JsonSerializer.Serialize(_latest, JsonOptions);
                }
                writer = _writer;
            }
            if (payload == null || writer == null) continue;
            try
            {
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
                Log.Info("[DraftAdvisor] overlay connected");
                KickFlush();
                await ReadClientAsync(server).ConfigureAwait(false);
                Log.Info("[DraftAdvisor] overlay disconnected");
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
