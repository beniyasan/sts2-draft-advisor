using DraftAdvisor.Codex;
using DraftAdvisor.Game;
using DraftAdvisor.UI;
using Godot;
using MegaCrit.Sts2.Core.Logging;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Nodes.Cards;
using MegaCrit.Sts2.Core.Nodes.Cards.Holders;
using MegaCrit.Sts2.Core.Nodes.Relics;

namespace DraftAdvisor.Advisor;

/// <summary>
/// Per-card advice bundle merged from the three Codex endpoints.
/// </summary>
public sealed class OfferAdvice
{
    public required string Id;
    public required Control Node;
    public required string DisplayName;
    public bool IsRelic;

    public int? AdviceRank;
    public double? AdviceScore;
    public double? AdviceBase;
    public List<DraftReason> Reasons = new();

    /// <summary>Relic offers: names of held cards that pair with this relic.</summary>
    public List<string> PairNames = new();

    public double? CoachScore;
    public double? CommitmentDelta;
    public double? WinnerSupport;

    public MetricRow? Metrics;
}

/// <summary>
/// Drives the whole flow for one open selection screen:
/// scan offered cards → snapshot deck → fetch Codex data → render overlay.
///
/// Threading: everything that touches the Godot scene tree runs on the main
/// thread (deferred callables). Only the HTTP fetch hops to Task.Run.
/// A generation counter drops stale results after close/refresh.
/// </summary>
public static class AdviceFlow
{
    private static volatile int _generation;

    /// <summary>Called from Harmony postfix when a selection screen opens or refreshes.</summary>
    public static void OnScreenOpened(Node screen)
    {
        var gen = ++_generation;
        AdvisorUi.Clear();
        Callable.From(() => TryScan(screen, gen, 0)).CallDeferred();
    }

    /// <summary>Called from Harmony postfix when a selection screen closes.</summary>
    public static void OnScreenClosed()
    {
        _generation++;
        AdvisorUi.Clear();
    }

    /// <summary>
    /// Scene-tree polling on the main thread via SceneTree timers (no reliance on a
    /// SynchronizationContext); HTTP runs on a thread-pool task and the result is
    /// marshalled back with CallDeferred.
    /// </summary>
    private static void TryScan(Node screen, int gen, int attempt)
    {
        try
        {
            if (gen != _generation || !GodotObject.IsInstanceValid(screen)) return;

            var offers = ScanOffers(screen);
            if (offers.Count == 0)
            {
                // Some screens populate their cards asynchronously — retry briefly.
                if (attempt < 6 && Engine.GetMainLoop() is SceneTree tree)
                {
                    var timer = tree.CreateTimer(attempt == 0 ? 0.05 : 0.25);
                    timer.Timeout += () => TryScan(screen, gen, attempt + 1);
                    return;
                }
                Log.Error("[DraftAdvisor] no offered cards found on screen");
                return;
            }

            var snap = RunInspector.Capture();
            if (snap == null || snap.HeldItems.Count == 0)
            {
                Log.Error("[DraftAdvisor] deck snapshot unavailable");
                return;
            }

            var offeredCardIds = offers.Where(o => !o.IsRelic).Select(o => o.Id).ToList();
            var offeredRelicIds = offers.Where(o => o.IsRelic).Select(o => o.Id).ToList();

            // HTTP only on a background thread; no Godot objects touched there.
            _ = Task.Run(async () =>
            {
                var a = offeredCardIds.Count > 0
                    ? CodexClient.GetDraftAdvice(snap.HeldItems, offeredCardIds)
                    : Task.FromResult<DraftAdviceResponse?>(null);
                // Empty offer is fine for pick-coach: it still resolves the archetype.
                var c = CodexClient.GetPickCoach(
                    snap.Character, snap.DeckCardIds, snap.RelicIds, offeredCardIds);
                var m = offeredCardIds.Count > 0
                    ? CodexClient.GetCardMetrics()
                    : Task.FromResult<Dictionary<string, MetricRow>?>(null);
                var rm = offeredRelicIds.Count > 0
                    ? CodexClient.GetRelicMetrics()
                    : Task.FromResult<Dictionary<string, MetricRow>?>(null);
                var rp = offeredRelicIds.Select(id => CodexClient.GetRelicPairings(id)).ToArray();

                await Task.WhenAll(new Task[] { a, c, m, rm }.Concat(rp)).ConfigureAwait(false);

                var advice = a.Result;
                var coach = c.Result;
                var metrics = m.Result;
                var relicMetrics = rm.Result;
                var relicPairings = rp.Select(t => t.Result).ToList();

                Callable.From(() =>
                {
                    if (gen != _generation || !GodotObject.IsInstanceValid(screen)) return;
                    MergeAdvice(offers, advice, coach, metrics);
                    MergeRelicAdvice(offers, offeredRelicIds, relicMetrics, relicPairings, snap);
                    AdvisorUi.Render(
                        screen, offers, snap.ItemNames,
                        coach?.Target?.Name, coach?.Target?.Similarity ?? 0);
                }).CallDeferred();
            });
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] pipeline failed: {ex.Message}");
        }
    }

    /// <summary>Find offered cards and relics anywhere under the screen node.</summary>
    private static List<OfferAdvice> ScanOffers(Node screen)
    {
        var cards = new List<(Control node, CardModel model)>();
        var relics = new List<(Control node, RelicModel model)>();
        FindOffersInTree(screen, cards, relics, 0);

        // Dedupe by node, not by id: the same card id can legitimately appear
        // in multiple slots (e.g. two copies for sale) and each needs a badge.
        // Holder/inner-child double-counting is prevented by FindOffersInTree
        // not recursing into matched holders.
        var offers = new List<OfferAdvice>();
        var seen = new HashSet<Control>();
        foreach (var (node, model) in cards)
        {
            if (!seen.Add(node)) continue;
            var id = RunInspector.NormalizeId(SafeEntry(model));
            if (string.IsNullOrEmpty(id)) continue;
            offers.Add(new OfferAdvice
            {
                Id = id,
                Node = node,
                DisplayName = SafeTitle(model) ?? Prettify(id),
            });
        }
        foreach (var (node, model) in relics)
        {
            if (!seen.Add(node)) continue;
            var id = RunInspector.NormalizeId(SafeEntry(model));
            if (string.IsNullOrEmpty(id)) continue;
            offers.Add(new OfferAdvice
            {
                Id = id,
                Node = node,
                DisplayName = SafeTitle(model) ?? Prettify(id),
                IsRelic = true,
            });
        }
        return offers;
    }

    private static string? SafeEntry(AbstractModel model)
    {
        try { return model.Id.Entry; } catch { return null; }
    }

    /// <summary>Title may be a plain string (cards) or a LocString (relics).</summary>
    private static string? SafeTitle(AbstractModel model)
    {
        try
        {
            var titleProp = model.GetType().GetProperty("Title",
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            var v = titleProp?.GetValue(model);
            if (v == null) return null;
            if (v is string s) return s;
            var fmt = v.GetType().GetMethod("GetFormattedText",
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance,
                Type.EmptyTypes);
            if (fmt?.Invoke(v, null) is string fs) return fs;
            return v.ToString();
        }
        catch { return null; }
    }

    /// <summary>"SETUP_STRIKE" → "Setup Strike".</summary>
    public static string Prettify(string id)
    {
        var parts = id.ToLowerInvariant().Split('_', StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < parts.Length; i++)
            parts[i] = char.ToUpperInvariant(parts[i][0]) + parts[i][1..];
        return string.Join(" ", parts);
    }

    private static void FindOffersInTree(
        Node parent,
        List<(Control, CardModel)> cards,
        List<(Control, RelicModel)> relics,
        int depth)
    {
        if (depth > 15) return;
        foreach (var child in parent.GetChildren())
        {
            if (child == null) continue;
            if (child is NCardHolder holder && holder.CardModel != null)
            {
                cards.Add((holder, holder.CardModel));
                continue;
            }
            if (child is NCard card && card.Model != null)
            {
                cards.Add((card, card.Model));
                continue;
            }
            // NRelicBasicHolder wraps an NRelic child: prefer the holder (better
            // anchor) and do NOT recurse into it, else the same relic is scanned twice.
            if (child is NRelicBasicHolder relicHolder && relicHolder.Relic?.Model != null)
            {
                relics.Add((relicHolder, relicHolder.Relic.Model));
                continue;
            }
            if (child is NRelic relic && relic.Model != null)
            {
                relics.Add((relic, relic.Model));
                continue;
            }
            FindOffersInTree(child, cards, relics, depth + 1);
        }
    }

    private static void MergeAdvice(
        List<OfferAdvice> offers,
        DraftAdviceResponse? advice,
        PickCoachResponse? coach,
        Dictionary<string, MetricRow>? metrics)
    {
        if (advice?.Ranked != null)
        {
            for (int i = 0; i < advice.Ranked.Count; i++)
            {
                var r = advice.Ranked[i];
                var offer = offers.FirstOrDefault(o =>
                    string.Equals(o.Id, r.Id, StringComparison.OrdinalIgnoreCase));
                if (offer == null) continue;
                offer.AdviceRank = i + 1;
                offer.AdviceScore = r.Score;
                offer.AdviceBase = r.Base;
                offer.Reasons = r.Reasons ?? new();
            }
        }

        if (coach?.Offers != null)
        {
            foreach (var c in coach.Offers)
            {
                var offer = offers.FirstOrDefault(o =>
                    string.Equals(o.Id, c.Id, StringComparison.OrdinalIgnoreCase));
                if (offer == null) continue;
                offer.CoachScore = c.CoachScore;
                offer.CommitmentDelta = c.CommitmentDelta;
                offer.WinnerSupport = c.WinnerSupport;
            }
        }

        if (metrics != null)
        {
            foreach (var offer in offers.Where(o => !o.IsRelic))
            {
                if (metrics.TryGetValue(offer.Id, out var m))
                    offer.Metrics = m;
            }
        }
    }

    /// <summary>
    /// Relic offers: generic metrics (tier/score/win%) plus deck-fit reasons built
    /// by intersecting the relic's top card partners with the player's deck.
    /// </summary>
    private static void MergeRelicAdvice(
        List<OfferAdvice> offers,
        IReadOnlyList<string> relicIds,
        Dictionary<string, MetricRow>? metrics,
        IReadOnlyList<PairingsResponse?> pairings,
        RunInspector.Snapshot snap)
    {
        var deckIds = new HashSet<string>(snap.DeckCardIds, StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < relicIds.Count; i++)
        {
            var offer = offers.FirstOrDefault(o => o.IsRelic &&
                string.Equals(o.Id, relicIds[i], StringComparison.OrdinalIgnoreCase));
            if (offer == null) continue;

            if (metrics != null && metrics.TryGetValue(offer.Id, out var m))
                offer.Metrics = m;

            var partners = i < pairings.Count ? pairings[i]?.Partners.Cards : null;
            if (partners != null)
            {
                offer.PairNames = partners
                    .Where(p => deckIds.Contains(p.Id))
                    .Take(2)
                    .Select(p => p.Name)
                    .ToList();
            }
        }
    }
}
