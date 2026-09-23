using HarmonyLib;
using DraftAdvisor.IPC;
using Godot;
using MegaCrit.Sts2.Core.Logging;
using MegaCrit.Sts2.Core.Modding;

namespace DraftAdvisor;

/// <summary>
/// STS2 discovers mods via this attribute and calls the named static method once on load.
/// </summary>
[ModInitializer(nameof(OnModLoaded))]
public static class ModEntry
{
    public static void OnModLoaded()
    {
        try
        {
            new Harmony("beniyasan.draftadvisor").PatchAll(typeof(ModEntry).Assembly);
            OverlayBridge.Start();
            OverlayLauncher.TryLaunch();
            RegisterHotkeyNode();
            Log.Info("[DraftAdvisor] Harmony patches applied.");
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] PatchAll failed: {ex}");
        }
    }

    /// <summary>
    /// Adds the overlay toggle hotkey listener to the scene tree root. Deferred
    /// so it lands after the tree is ready.
    /// </summary>
    private static void RegisterHotkeyNode()
    {
        try
        {
            if (Engine.GetMainLoop() is not SceneTree tree || tree.Root == null) return;
            Callable.From(() => tree.Root.AddChild(new OverlayHotkeyNode())).CallDeferred();
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] hotkey node registration failed: {ex.Message}");
        }
    }
}
