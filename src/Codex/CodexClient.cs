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

    private static Dictionary<string, MetricRow>? _metricsCache;
    private static DateTime _metricsFetchedAt = DateTime.MinValue;
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

    /// <summary>
    /// GET /api/runs/metrics/cards — full card metrics table (tier, elo, pick%, win%).
    /// Cached for <see cref="MetricsTtl"/>.
    /// </summary>
    public static async Task<Dictionary<string, MetricRow>?> GetCardMetrics()
    {
        if (_metricsCache != null && DateTime.UtcNow - _metricsFetchedAt < MetricsTtl)
            return _metricsCache;

        await _metricsLock.WaitAsync();
        try
        {
            if (_metricsCache != null && DateTime.UtcNow - _metricsFetchedAt < MetricsTtl)
                return _metricsCache;

            var resp = await Http.GetFromJsonAsync<MetricsResponse>(
                "/api/runs/metrics/cards?bracket=all", JsonOpts);
            if (resp?.Rows == null) return _metricsCache;

            var map = new Dictionary<string, MetricRow>(StringComparer.OrdinalIgnoreCase);
            foreach (var row in resp.Rows)
                if (!string.IsNullOrEmpty(row.Id))
                    map[row.Id] = row;

            _metricsCache = map;
            _metricsFetchedAt = DateTime.UtcNow;
            Log.Info($"[DraftAdvisor] metrics cached: {map.Count} cards");
            return _metricsCache;
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] metrics failed: {ex.Message}");
            return _metricsCache;
        }
        finally
        {
            _metricsLock.Release();
        }
    }

    /// <summary>
    /// GET /api/pairings/cards/{id} — partners seen in the same runs.
    /// Used to explain "held cards that make this offer attractive".
    /// </summary>
    public static async Task<JsonDocument?> GetPairings(string cardId)
    {
        try
        {
            using var stream = await Http.GetStreamAsync($"/api/pairings/cards/{cardId}");
            return await JsonDocument.ParseAsync(stream);
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] pairings({cardId}) failed: {ex.Message}");
            return null;
        }
    }
}
