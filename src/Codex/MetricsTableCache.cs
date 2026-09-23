using MegaCrit.Sts2.Core.Logging;

namespace DraftAdvisor.Codex;

/// <summary>
/// Owns the per-entity metrics tables and their refresh policy. A failed refresh
/// leaves the last successful table available to callers.
/// </summary>
internal sealed class MetricsTableCache
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(30);

    private readonly Dictionary<string, (Dictionary<string, MetricRow> Map, DateTime At)> _caches =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly object _cacheLock = new();
    private readonly SemaphoreSlim _refreshLock = new(1, 1);

    public async Task<Dictionary<string, MetricRow>?> GetAsync(
        string entityType, Func<Task<MetricsResponse?>> load)
    {
        var hit = GetEntry(entityType);
        if (IsFresh(hit))
            return hit.Map;

        await _refreshLock.WaitAsync();
        try
        {
            hit = GetEntry(entityType);
            if (IsFresh(hit))
                return hit.Map;

            var response = await load();
            if (response?.Rows == null)
                return hit.Map;

            var map = new Dictionary<string, MetricRow>(StringComparer.OrdinalIgnoreCase);
            foreach (var row in response.Rows)
                if (!string.IsNullOrEmpty(row.Id))
                    map[row.Id] = row;

            lock (_cacheLock)
                _caches[entityType] = (map, DateTime.UtcNow);
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
            _refreshLock.Release();
        }
    }

    private static bool IsFresh((Dictionary<string, MetricRow> Map, DateTime At) entry) =>
        entry.Map != null && DateTime.UtcNow - entry.At < Ttl;

    private (Dictionary<string, MetricRow> Map, DateTime At) GetEntry(string entityType)
    {
        lock (_cacheLock)
        {
            _caches.TryGetValue(entityType, out var entry);
            return entry;
        }
    }
}
