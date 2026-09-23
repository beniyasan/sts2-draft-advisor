using System.Net.Http.Json;
using System.Text.Json;
using MegaCrit.Sts2.Core.Logging;

namespace DraftAdvisor.Codex;

/// <summary>
/// Thin async client for the public spire-codex.com API (no auth required).
/// All calls fail soft: on any error the returned value is null and the
/// overlay simply renders without that data.
/// </summary>
public static class CodexClient
{
    private const string BaseUrl = "https://spire-codex.com";

    private static readonly HttpClient Http = new()
    {
        BaseAddress = new Uri(BaseUrl),
        Timeout = TimeSpan.FromSeconds(10),
        DefaultRequestHeaders =
        {
            { "User-Agent", "sts2-DraftAdvisor-mod/0.1 (+https://spire-codex.com)" },
        },
    };

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static readonly MetricsTableCache MetricsCache = new();

    /// <summary>
    /// POST /api/draft-advice — rank offered cards against the current deck.
    /// Deck items are "cards:ID" / "relics:ID".
    /// </summary>
    public static async Task<DraftAdviceResponse?> GetDraftAdvice(
        IReadOnlyList<string> deck, IReadOnlyList<string> offered, CancellationToken cancellationToken = default)
    {
        var body = new { deck, offered, lang = "eng" };
        return await PostJsonAsync<DraftAdviceResponse>(
            "/api/draft-advice", body, "draft-advice failed", cancellationToken);
    }

    /// <summary>
    /// GET /api/runs/pick-coach — nearest archetype + per-offer coach score.
    /// </summary>
    public static async Task<PickCoachResponse?> GetPickCoach(
        string character, IReadOnlyList<string> cardIds,
        IReadOnlyList<string> relicIds, IReadOnlyList<string> offered,
        CancellationToken cancellationToken = default)
    {
        var url = "/api/runs/pick-coach"
            + $"?character={Uri.EscapeDataString(character.ToLowerInvariant())}"
            + $"&cards={Uri.EscapeDataString(string.Join(",", cardIds))}"
            + $"&relics={Uri.EscapeDataString(string.Join(",", relicIds))}"
            + $"&offer={Uri.EscapeDataString(string.Join(",", offered))}";
        return await GetJsonAsync<PickCoachResponse>(url, "pick-coach failed", cancellationToken);
    }

    /// <summary>GET /api/runs/metrics/cards — cached for 30 minutes.</summary>
    public static Task<Dictionary<string, MetricRow>?> GetCardMetrics(CancellationToken cancellationToken = default) => GetMetricsTable("cards", cancellationToken);

    /// <summary>GET /api/runs/metrics/relics — cached for 30 minutes.</summary>
    public static Task<Dictionary<string, MetricRow>?> GetRelicMetrics(CancellationToken cancellationToken = default) => GetMetricsTable("relics", cancellationToken);

    /// <summary>
    /// GET /api/runs/metrics/{entity} — full metrics table (tier, elo, pick%, win%).
    /// Relics rows have no pick_rate/elo — those fields stay null.
    /// </summary>
    private static async Task<Dictionary<string, MetricRow>?> GetMetricsTable(string entityType, CancellationToken cancellationToken)
    {
        // Metrics refreshes belong to the shared cache, so screen cancellation
        // stops this caller waiting without cancelling or discarding the refresh.
        return await MetricsCache.GetAsync(entityType, () => GetJsonAsync<MetricsResponse>(
            $"/api/runs/metrics/{entityType}?bracket=all", $"metrics({entityType}) failed"))
            .WaitAsync(cancellationToken);
    }

    /// <summary>
    /// GET /api/pairings/relics/{id} — cards most associated with this relic.
    /// partners.cards ∩ the player's deck explains "which held cards want this relic".
    /// </summary>
    public static async Task<PairingsResponse?> GetRelicPairings(string relicId, CancellationToken cancellationToken = default)
    {
        return await GetJsonAsync<PairingsResponse>(
            $"/api/pairings/relics/{relicId}", $"pairings({relicId}) failed", cancellationToken);
    }

    private static Task<T?> GetJsonAsync<T>(string url, string failureContext, CancellationToken cancellationToken = default) =>
        ExecuteJsonRequestAsync<T>(HttpMethod.Get, url, null, failureContext, cancellationToken);

    private static Task<T?> PostJsonAsync<T>(string url, object body, string failureContext, CancellationToken cancellationToken = default) =>
        ExecuteJsonRequestAsync<T>(HttpMethod.Post, url, body, failureContext, cancellationToken);

    private static async Task<T?> ExecuteJsonRequestAsync<T>(
        HttpMethod method, string url, object? body, string failureContext, CancellationToken cancellationToken)
    {
        try
        {
            using (var request = new HttpRequestMessage(method, url))
            {
                if (body != null)
                    request.Content = JsonContent.Create(body);

                using (var response = await Http.SendAsync(request, cancellationToken))
                {
                    response.EnsureSuccessStatusCode();
                    return await response.Content.ReadFromJsonAsync<T>(JsonOpts, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogRequestFailure(failureContext, ex);
            return default;
        }
    }

    private static Task<T?> ReadJsonAsync<T>(HttpResponseMessage response) =>
        response.Content.ReadFromJsonAsync<T>(JsonOpts);

    private static void LogRequestFailure(string failureContext, Exception exception) =>
        Log.Error($"[DraftAdvisor] {failureContext}: {exception.Message}");
}
