using DraftAdvisor.Codex;
using DraftAdvisor.Game;

namespace DraftAdvisor.Advisor;

/// <summary>
/// Applies Codex responses to offer data without depending on Godot or UI state.
/// </summary>
public static class AdviceMerger
{
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
                    string.Equals(o.Id, r.Id, StringComparison.OrdinalIgnoreCase)))
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
                    string.Equals(o.Id, c.Id, StringComparison.OrdinalIgnoreCase)))
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
                if (metrics.TryGetValue(offer.Id, out var m))
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
                string.Equals(o.Id, relicIds[i], StringComparison.OrdinalIgnoreCase)))
            {
                if (metrics != null && metrics.TryGetValue(offer.Id, out var m))
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
}
