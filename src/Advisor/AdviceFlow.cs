using DraftAdvisor.Codex;
using DraftAdvisor.Game;
using DraftAdvisor.UI;
using Godot;
using MegaCrit.Sts2.Core.Logging;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Nodes.Cards;
using MegaCrit.Sts2.Core.Nodes.Cards.Holders;

namespace DraftAdvisor.Advisor;

/// <summary>
/// Per-card advice bundle merged from the three Codex endpoints.
/// </summary>
public sealed class OfferAdvice
{
    public required string Id;
    public required Control Node;
    public required string DisplayName;

    public int? AdviceRank;
    public double? AdviceScore;
    public double? AdviceBase;
    public List<DraftReason> Reasons = new();

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

            var offeredIds = offers.Select(o => o.Id).ToList();

            // HTTP only on a background thread; no Godot objects touched there.
            _ = Task.Run(async () =>
            {
                var a = CodexClient.GetDraftAdvice(snap.HeldItems, offeredIds);
                var c = CodexClient.GetPickCoach(
                    snap.Character, snap.DeckCardIds, snap.RelicIds, offeredIds);
                var m = CodexClient.GetCardMetrics();
                await Task.WhenAll(a, c, m).ConfigureAwait(false);
                var advice = a.Result;
                var coach = c.Result;
                var metrics = m.Result;

                Callable.From(() =>
                {
                    if (gen != _generation || !GodotObject.IsInstanceValid(screen)) return;
                    MergeAdvice(offers, advice, coach, metrics);
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

    /// <summary>Find offered cards: NCardHolder (grid) then bare NCard nodes (bundles).</summary>
    private static List<OfferAdvice> ScanOffers(Node screen)
    {
        var found = new List<(Control node, CardModel model)>();
        FindCardsInTree(screen, found, 0);

        var offers = new List<OfferAdvice>();
        var seen = new HashSet<Control>();
        foreach (var (node, model) in found)
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
        return offers;
    }

    private static string? SafeEntry(CardModel model)
    {
        try { return model.Id.Entry; } catch { return null; }
    }

    /// <summary>Title may be a plain string or a localized text object.</summary>
    private static string? SafeTitle(CardModel model)
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

    private static void FindCardsInTree(Node parent, List<(Control, CardModel)> results, int depth)
    {
        if (depth > 15) return;
        foreach (var child in parent.GetChildren())
        {
            if (child == null) continue;
            if (child is NCardHolder holder && holder.CardModel != null)
            {
                results.Add((holder, holder.CardModel));
                continue;
            }
            if (child is NCard card && card.Model != null)
            {
                results.Add((card, card.Model));
                continue;
            }
            FindCardsInTree(child, results, depth + 1);
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
            foreach (var offer in offers)
            {
                if (metrics.TryGetValue(offer.Id, out var m))
                    offer.Metrics = m;
            }
        }
    }
}
