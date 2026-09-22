using DraftAdvisor.Advisor;
using HarmonyLib;
using MegaCrit.Sts2.Core.Nodes.Screens;
using MegaCrit.Sts2.Core.Nodes.Screens.CardSelection;
using MegaCrit.Sts2.Core.Nodes.Screens.Shops;

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

/// <summary>
/// Relic pick screens ("choose a relic"). NRelic nodes are scanned for offers.
/// </summary>
[HarmonyPatch(typeof(NChooseARelicSelection), nameof(NChooseARelicSelection.AfterOverlayOpened))]
public static class ChooseRelicOpenedPatch
{
    [HarmonyPostfix]
    public static void AfterOpened(NChooseARelicSelection __instance)
        => AdviceFlow.OnScreenOpened(__instance);
}

[HarmonyPatch(typeof(NChooseARelicSelection), nameof(NChooseARelicSelection.AfterOverlayClosed))]
public static class ChooseRelicClosedPatch
{
    [HarmonyPostfix]
    public static void AfterClosed()
        => AdviceFlow.OnScreenClosed();
}

/// <summary>
/// Merchant shop: card slots contain NCard children, relic slots NRelic children —
/// the same tree scan covers both. Badges show under each purchasable item.
/// </summary>
[HarmonyPatch(typeof(NMerchantInventory), nameof(NMerchantInventory.Open))]
public static class MerchantOpenedPatch
{
    [HarmonyPostfix]
    public static void AfterOpened(NMerchantInventory __instance)
        => AdviceFlow.OnScreenOpened(__instance);
}

// Close() is private; _ExitTree is the reliable "screen gone" hook — badges are
// children of the merchant nodes and die with them anyway.
[HarmonyPatch(typeof(NMerchantInventory), nameof(NMerchantInventory._ExitTree))]
public static class MerchantClosedPatch
{
    [HarmonyPostfix]
    public static void AfterClosed()
        => AdviceFlow.OnScreenClosed();
}

/// <summary>
/// A merchant slot got (re)filled — restock after purchase or a reroll.
/// Triggers a rescan so the new item gets a badge too. Harmless during the
/// initial fill: OnContentChanged is a no-op until Open has tracked the screen.
/// </summary>
[HarmonyPatch(typeof(NMerchantCard), nameof(NMerchantCard.FillSlot))]
public static class MerchantCardFillPatch
{
    [HarmonyPostfix]
    public static void AfterFill()
        => AdviceFlow.OnContentChanged();
}

[HarmonyPatch(typeof(NMerchantRelic), nameof(NMerchantRelic.FillSlot))]
public static class MerchantRelicFillPatch
{
    [HarmonyPostfix]
    public static void AfterFill()
        => AdviceFlow.OnContentChanged();
}
