using DraftAdvisor.Codex;
using DraftAdvisor.Game;
using MegaCrit.Sts2.Core.Logging;

namespace DraftAdvisor.Advisor;

/// <summary>
/// Applies Codex responses to offer data without depending on Godot or UI state.
/// </summary>
public static class AdviceMerger
{
    private static readonly HashSet<string> MissingMetricLog = new(StringComparer.OrdinalIgnoreCase);

    public static void MergeAdvice(
        List<OfferAdvice> offers,
        DraftAdviceResponse? advice,
        PickCoachResponse? coach,
        Dictionary<string, MetricRow>? metrics)
    {
        // Merge into EVERY offer matching the id — identical cards can occupy
        // several slots (e.g. shop restock) and each badge needs the same advice.
        if (advice?.Ranked != null)
        {
            for (int i = 0; i < advice.Ranked.Count; i++)
            {
                var r = advice.Ranked[i];
                foreach (var offer in offers.Where(o => !o.IsRelic &&
                    SameId(o.Id, r.Id)))
                {
                    offer.AdviceRank = i + 1;
                    offer.AdviceScore = r.Score;
                    offer.AdviceBase = r.Base;
                    offer.Reasons = r.Reasons ?? new();
                }
            }
        }

        if (coach?.Offers != null)
        {
            foreach (var c in coach.Offers)
            {
                foreach (var offer in offers.Where(o => !o.IsRelic &&
                    SameId(o.Id, c.Id)))
                {
                    offer.CoachScore = c.CoachScore;
                    offer.CommitmentDelta = c.CommitmentDelta;
                    offer.WinnerSupport = c.WinnerSupport;
                }
            }
        }

        if (metrics != null)
        {
            foreach (var offer in offers.Where(o => !o.IsRelic))
            {
                if (TryGetMetric(metrics, offer.Id, out var m))
                    offer.Metrics = m;
            }
        }
    }

    /// <summary>
    /// Adds relic metrics and deck-fit partners, then ranks relic offers by score.
    /// Pairing responses stay aligned positionally with the distinct relic IDs.
    /// </summary>
    public static void MergeRelicAdvice(
        List<OfferAdvice> offers,
        IReadOnlyList<string> relicIds,
        Dictionary<string, MetricRow>? metrics,
        IReadOnlyList<PairingsResponse?> pairings,
        RunInspector.Snapshot snap)
    {
        var deckIds = new HashSet<string>(snap.DeckCardIds, StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < relicIds.Count; i++)
        {
            var partners = i < pairings.Count ? pairings[i]?.Partners.Cards : null;
            var pairNames = partners == null
                ? new List<string>()
                : partners.Where(p => deckIds.Contains(p.Id)).Take(2).Select(p => p.Name).ToList();

            foreach (var offer in offers.Where(o => o.IsRelic &&
                SameId(o.Id, relicIds[i])))
            {
                if (metrics != null && TryGetMetric(metrics, offer.Id, out var m))
                    offer.Metrics = m;
                offer.PairNames = pairNames;
            }
        }

        // Rank relic offers against each other by score so "which of these" is
        // visible on Neow and other multi-relic choice screens.
        var rank = 0;
        foreach (var o in offers.Where(o => o.IsRelic)
            .OrderByDescending(o => o.Metrics?.Score ?? -1))
        {
            if (o.Metrics == null) continue;
            o.AdviceRank = ++rank;
        }
    }

    private static bool SameId(string left, string right) =>
        string.Equals(left, right, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(CodexId.Canonical(left), CodexId.Canonical(right), StringComparison.Ordinal);

    private static bool TryGetMetric(
        Dictionary<string, MetricRow> metrics, string id, out MetricRow row)
    {
        if (metrics.TryGetValue(id, out row!)) return true;
        var canonical = CodexId.Canonical(id);
        if (!string.IsNullOrEmpty(canonical) && metrics.TryGetValue(canonical, out row!)) return true;
        if (MissingMetricLog.Add(id))
            Log.Info($"[DraftAdvisor] metrics row missing: id={id}, canonical={canonical}");
        return false;
    }
}
