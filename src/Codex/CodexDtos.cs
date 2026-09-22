using System.Text.Json.Serialization;

namespace DraftAdvisor.Codex;

/// <summary>POST /api/draft-advice response row.</summary>
public sealed class DraftRanked
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("score")] public double Score { get; set; }
    [JsonPropertyName("base")] public double Base { get; set; }
    [JsonPropertyName("reasons")] public List<DraftReason> Reasons { get; set; } = new();
}

public sealed class DraftReason
{
    [JsonPropertyName("from")] public string From { get; set; } = "";
    [JsonPropertyName("lift")] public double Lift { get; set; }
    [JsonPropertyName("winrate")] public double Winrate { get; set; }
}

public sealed class DraftAdviceResponse
{
    [JsonPropertyName("ranked")] public List<DraftRanked> Ranked { get; set; } = new();
}

/// <summary>GET /api/runs/metrics/cards response row.</summary>
public sealed class MetricRow
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("score")] public double Score { get; set; }
    [JsonPropertyName("tier")] public string Tier { get; set; } = "?";
    [JsonPropertyName("elo")] public double Elo { get; set; }
    [JsonPropertyName("win_rate")] public double WinRate { get; set; }
    [JsonPropertyName("pick_rate")] public double PickRate { get; set; }
}

public sealed class MetricsResponse
{
    [JsonPropertyName("rows")] public List<MetricRow> Rows { get; set; } = new();
}

/// <summary>GET /api/runs/pick-coach response.</summary>
public sealed class CoachArchetype
{
    [JsonPropertyName("key")] public string Key { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("win_rate")] public double WinRate { get; set; }
    [JsonPropertyName("share")] public double Share { get; set; }
    [JsonPropertyName("similarity")] public double Similarity { get; set; }
}

public sealed class CoachOffer
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("coach_score")] public double CoachScore { get; set; }
    [JsonPropertyName("commitment_delta")] public double CommitmentDelta { get; set; }
    [JsonPropertyName("winner_support")] public double WinnerSupport { get; set; }
    [JsonPropertyName("take_score")] public double TakeScore { get; set; }
}

public sealed class PickCoachResponse
{
    [JsonPropertyName("available")] public bool Available { get; set; }
    [JsonPropertyName("target")] public CoachArchetype? Target { get; set; }
    [JsonPropertyName("offers")] public List<CoachOffer> Offers { get; set; } = new();
}
