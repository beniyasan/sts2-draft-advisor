namespace DraftAdvisor.Codex;

/// <summary>
/// Canonicalizes entity IDs before comparing them. The game and Codex normally
/// agree on IDs, but older/newer game builds have used prefixes and separators
/// such as CARD_BLOOD_LETTING while the API uses BLOODLETTING.
/// </summary>
public static class CodexId
{
    public static string Canonical(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return string.Empty;

        var value = id.Trim();
        var colon = value.LastIndexOf(':');
        if (colon >= 0 && colon + 1 < value.Length)
            value = value[(colon + 1)..];

        if (value.StartsWith("CARD_", StringComparison.OrdinalIgnoreCase))
            value = value[5..];
        else if (value.StartsWith("RELIC_", StringComparison.OrdinalIgnoreCase))
            value = value[6..];

        var chars = value.Where(char.IsLetterOrDigit).ToArray();
        return new string(chars).ToUpperInvariant();
    }
}
