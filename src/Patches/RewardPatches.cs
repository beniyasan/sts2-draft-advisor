using DraftAdvisor.Advisor;
using HarmonyLib;
using MegaCrit.Sts2.Core.Nodes.Screens.CardSelection;

namespace DraftAdvisor.Patches;

/// <summary>
/// Post-combat card reward screen ("choose 1 of 3").
/// </summary>
[HarmonyPatch(typeof(NCardRewardSelectionScreen), nameof(NCardRewardSelectionScreen.AfterOverlayOpened))]
public static class CardRewardOpenedPatch
{
    [HarmonyPostfix]
    public static void AfterOpened(NCardRewardSelectionScreen __instance)
        => AdviceFlow.OnScreenOpened(__instance);
}

[HarmonyPatch(typeof(NCardRewardSelectionScreen), nameof(NCardRewardSelectionScreen.RefreshOptions))]
public static class CardRewardRefreshPatch
{
    [HarmonyPostfix]
    public static void AfterRefresh(NCardRewardSelectionScreen __instance)
        => AdviceFlow.OnScreenOpened(__instance);
}

[HarmonyPatch(typeof(NCardRewardSelectionScreen), nameof(NCardRewardSelectionScreen.AfterOverlayClosed))]
public static class CardRewardClosedPatch
{
    [HarmonyPostfix]
    public static void AfterClosed()
        => AdviceFlow.OnScreenClosed();
}

/// <summary>
/// "Choose a card" screens (e.g. event/graveyard style pick-1-of-3).
/// </summary>
[HarmonyPatch(typeof(NChooseACardSelectionScreen), nameof(NChooseACardSelectionScreen.AfterOverlayOpened))]
public static class ChooseCardOpenedPatch
{
    [HarmonyPostfix]
    public static void AfterOpened(NChooseACardSelectionScreen __instance)
        => AdviceFlow.OnScreenOpened(__instance);
}

[HarmonyPatch(typeof(NChooseACardSelectionScreen), nameof(NChooseACardSelectionScreen.AfterOverlayClosed))]
public static class ChooseCardClosedPatch
{
    [HarmonyPostfix]
    public static void AfterClosed()
        => AdviceFlow.OnScreenClosed();
}
