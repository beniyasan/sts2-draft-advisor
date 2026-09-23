using DraftAdvisor.Advisor;
using DraftAdvisor.Game;

namespace DraftAdvisor.IPC;

public sealed class OverlayGameState
{
    public int Version { get; init; } = 1;
    public string Type { get; init; } = "game_state";
    public string RunId { get; init; } = "unknown";
    public long Timestamp { get; init; }
    public OverlayScreenState Screen { get; init; } = new();
    public OverlayPlayerState Player { get; init; } = new();
}

public sealed class OverlayScreenState
{
    public string Kind { get; init; } = "unknown";
    public IReadOnlyList<OverlayOfferState> Offers { get; init; } = Array.Empty<OverlayOfferState>();
}

public sealed class OverlayOfferState
{
    public string Id { get; init; } = "";
    public string DisplayName { get; init; } = "";
    public bool IsRelic { get; init; }
    public bool IsCursed { get; init; }
}

public sealed class OverlayPlayerState
{
    public string Character { get; init; } = "ironclad";
    public IReadOnlyList<OverlayCardState> Deck { get; init; } = Array.Empty<OverlayCardState>();
    public IReadOnlyList<string> Relics { get; init; } = Array.Empty<string>();
}

public sealed class OverlayCardState
{
    public string Id { get; init; } = "";
    public bool Upgraded { get; init; }
}

public sealed class OverlayPipeMessage
{
    public string Type { get; init; } = "";
}

internal static class OverlayStateFactory
{
    public static OverlayGameState Create(string screenKind, RunInspector.Snapshot snapshot,
        IReadOnlyList<OfferAdvice> offers)
    {
        var deck = snapshot.DeckCardIds
            .Select((id, index) => new OverlayCardState
            {
                Id = id,
                Upgraded = index < snapshot.DeckCardUpgraded.Count && snapshot.DeckCardUpgraded[index],
            })
            .ToList();
        var offerStates = offers.Select(offer => new OverlayOfferState
        {
            Id = offer.Id,
            DisplayName = offer.DisplayName,
            IsRelic = offer.IsRelic,
            IsCursed = offer.IsCursed,
        }).ToList();

        return new OverlayGameState
        {
            RunId = $"{snapshot.Character}:{string.Join(',', snapshot.DeckCardIds)}",
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Screen = new OverlayScreenState { Kind = screenKind, Offers = offerStates },
            Player = new OverlayPlayerState
            {
                Character = snapshot.Character,
                Deck = deck,
                Relics = snapshot.RelicIds.ToList(),
            },
        };
    }
}
