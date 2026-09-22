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

    /// <summary>Metrics table is a few hundred rows; cache once per session.</summary>
    private static readonly TimeSpan MetricsTtl = TimeSpan.FromMinutes(30);

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

    private static readonly Dictionary<string, (Dictionary<string, MetricRow> Map, DateTime At)> _metricsCaches = new();
    private static readonly SemaphoreSlim _metricsLock = new(1, 1);

    /// <summary>
    /// POST /api/draft-advice — rank offered cards against the current deck.
    /// Deck items are "cards:ID" / "relics:ID".
    /// </summary>
    public static async Task<DraftAdviceResponse?> GetDraftAdvice(
        IReadOnlyList<string> deck, IReadOnlyList<string> offered)
    {
        try
        {
            var body = new { deck, offered, lang = "eng" };
            using var resp = await Http.PostAsJsonAsync("/api/draft-advice", body);
            resp.EnsureSuccessStatusCode();
            return await resp.Content.ReadFromJsonAsync<DraftAdviceResponse>(JsonOpts);
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] draft-advice failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// GET /api/runs/pick-coach — nearest archetype + per-offer coach score.
    /// </summary>
    public static async Task<PickCoachResponse?> GetPickCoach(
        string character, IReadOnlyList<string> cardIds,
        IReadOnlyList<string> relicIds, IReadOnlyList<string> offered)
    {
        try
        {
            var url = "/api/runs/pick-coach"
                + $"?character={Uri.EscapeDataString(character.ToLowerInvariant())}"
                + $"&cards={Uri.EscapeDataString(string.Join(",", cardIds))}"
                + $"&relics={Uri.EscapeDataString(string.Join(",", relicIds))}"
                + $"&offer={Uri.EscapeDataString(string.Join(",", offered))}";
            return await Http.GetFromJsonAsync<PickCoachResponse>(url, JsonOpts);
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] pick-coach failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>GET /api/runs/metrics/cards — cached for <see cref="MetricsTtl"/>.</summary>
    public static Task<Dictionary<string, MetricRow>?> GetCardMetrics() => GetMetricsTable("cards");

    /// <summary>GET /api/runs/metrics/relics — cached for <see cref="MetricsTtl"/>.</summary>
    public static Task<Dictionary<string, MetricRow>?> GetRelicMetrics() => GetMetricsTable("relics");

    /// <summary>
    /// GET /api/runs/metrics/{entity} — full metrics table (tier, elo, pick%, win%).
    /// Relics rows have no pick_rate/elo — those fields stay null.
    /// </summary>
    private static async Task<Dictionary<string, MetricRow>?> GetMetricsTable(string entityType)
    {
        _metricsCaches.TryGetValue(entityType, out var hit);
        if (hit.Map != null && DateTime.UtcNow - hit.At < MetricsTtl)
            return hit.Map;

        await _metricsLock.WaitAsync();
        try
        {
            _metricsCaches.TryGetValue(entityType, out hit);
            if (hit.Map != null && DateTime.UtcNow - hit.At < MetricsTtl)
                return hit.Map;

            var resp = await Http.GetFromJsonAsync<MetricsResponse>(
                $"/api/runs/metrics/{entityType}?bracket=all", JsonOpts);
            if (resp?.Rows == null) return hit.Map;

            var map = new Dictionary<string, MetricRow>(StringComparer.OrdinalIgnoreCase);
            foreach (var row in resp.Rows)
                if (!string.IsNullOrEmpty(row.Id))
                    map[row.Id] = row;

            _metricsCaches[entityType] = (map, DateTime.UtcNow);
            Log.Info($"[DraftAdvisor] metrics cached: {map.Count} {entityType}");
            return map;
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] metrics({entityType}) failed: {ex.Message}");
            return hit.Map;
        }
        finally
        {
            _metricsLock.Release();
        }
    }

    /// <summary>
    /// GET /api/pairings/relics/{id} — cards most associated with this relic.
    /// partners.cards ∩ the player's deck explains "which held cards want this relic".
    /// </summary>
    public static async Task<PairingsResponse?> GetRelicPairings(string relicId)
    {
        try
        {
            return await Http.GetFromJsonAsync<PairingsResponse>(
                $"/api/pairings/relics/{relicId}", JsonOpts);
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] pairings({relicId}) failed: {ex.Message}");
            return null;
        }
    }
}
