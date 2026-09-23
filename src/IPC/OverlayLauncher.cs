using System.Diagnostics;
using System.Reflection;
using MegaCrit.Sts2.Core.Logging;

namespace DraftAdvisor.IPC;

/// <summary>
/// Best-effort auto-launch of the companion Electron overlay. Looks for an
/// installed overlay next to the mod DLL and starts its electron binary
/// detached. Everything is fail-soft — without an overlay install the mod
/// simply behaves as before.
/// </summary>
public static class OverlayLauncher
{
    private static bool _attempted;

    /// <summary>Overlay directories searched relative to the mod folder.</summary>
    private static readonly string[] CandidateDirs =
    {
        "overlay",
        Path.Combine("..", "DraftAdvisor.overlay"),
    };

    public static void TryLaunch()
    {
        if (_attempted) return;
        _attempted = true;
        try
        {
            var modDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (string.IsNullOrEmpty(modDir)) return;
            foreach (var relative in CandidateDirs)
            {
                var overlayDir = Path.GetFullPath(Path.Combine(modDir, relative));
                var exe = Path.Combine(overlayDir, "node_modules", "electron", "dist", "electron.exe");
                if (!File.Exists(exe) || !File.Exists(Path.Combine(overlayDir, "package.json"))) continue;
                Process.Start(new ProcessStartInfo(exe, $"\"{overlayDir}\"")
                {
                    WorkingDirectory = overlayDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });
                Log.Info($"[DraftAdvisor] overlay launched: {overlayDir}");
                return;
            }
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] overlay launch failed: {ex.Message}");
        }
    }
}
