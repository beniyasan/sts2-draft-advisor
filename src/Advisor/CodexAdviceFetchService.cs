using DraftAdvisor.Codex;

namespace DraftAdvisor.Advisor;

/// <summary>Data returned by the Codex acquisition step, with no scene objects.</summary>
public sealed class CodexAdviceFetchResult
{
    public DraftAdviceResponse? Advice { get; init; }
    public PickCoachResponse? Coach { get; init; }
    public Dictionary<string, MetricRow>? CardMetrics { get; init; }
    public Dictionary<string, MetricRow>? RelicMetrics { get; init; }
    public required IReadOnlyList<string> RelicIds { get; init; }
    public required IReadOnlyList<PairingsResponse?> RelicPairings { get; init; }
}

/// <summary>Fetches all Codex data for an offer set without touching Godot objects.</summary>
public static class CodexAdviceFetchService
{
    public static async Task<CodexAdviceFetchResult> FetchAsync(
        string character,
        IReadOnlyList<string> deckCardIds,
        IReadOnlyList<string> relicIds,
        IReadOnlyList<string> heldItems,
        IReadOnlyList<string> offeredCardIds,
        IReadOnlyList<string> distinctRelicIds,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var adviceTask = offeredCardIds.Count > 0
            ? CodexClient.GetDraftAdvice(heldItems, offeredCardIds, cancellationToken)
            : Task.FromResult<DraftAdviceResponse?>(null);
        // Empty offer is fine for pick-coach: it still resolves the archetype.
        var coachTask = CodexClient.GetPickCoach(character, deckCardIds, relicIds, offeredCardIds, cancellationToken);
        var cardMetricsTask = offeredCardIds.Count > 0
            ? CodexClient.GetCardMetrics(cancellationToken)
            : Task.FromResult<Dictionary<string, MetricRow>?>(null);
        var relicMetricsTask = distinctRelicIds.Count > 0
            ? CodexClient.GetRelicMetrics(cancellationToken)
            : Task.FromResult<Dictionary<string, MetricRow>?>(null);
        var pairingsTasks = distinctRelicIds.Select(id => CodexClient.GetRelicPairings(id, cancellationToken)).ToArray();

        await Task.WhenAll(new Task[] { adviceTask, coachTask, cardMetricsTask, relicMetricsTask }
            .Concat(pairingsTasks)).ConfigureAwait(false);

        return new CodexAdviceFetchResult
        {
            Advice = adviceTask.Result,
            Coach = coachTask.Result,
            CardMetrics = cardMetricsTask.Result,
            RelicMetrics = relicMetricsTask.Result,
            RelicIds = distinctRelicIds,
            RelicPairings = pairingsTasks.Select(task => task.Result).ToList(),
        };
    }
}
