using HarmonyLib;
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
            Log.Info("[DraftAdvisor] Harmony patches applied.");
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] PatchAll failed: {ex}");
        }
    }
}
