namespace DraftAdvisor;

/// <summary>Pure formatting helpers for readable names derived from game ids.</summary>
public static class DisplayNameFormatter
{
    /// <summary>"SETUP_STRIKE" → "Setup Strike".</summary>
    public static string Prettify(string id)
    {
        var parts = id.ToLowerInvariant().Split('_', StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < parts.Length; i++)
            parts[i] = char.ToUpperInvariant(parts[i][0]) + parts[i][1..];
        return string.Join(" ", parts);
    }
}
