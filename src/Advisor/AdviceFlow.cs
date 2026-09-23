using DraftAdvisor.Codex;
using DraftAdvisor.Game;
using DraftAdvisor.IPC;
using DraftAdvisor.UI;
using Godot;
using MegaCrit.Sts2.Core.Logging;

namespace DraftAdvisor.Advisor;

/// <summary>
/// Per-card advice bundle merged from the three Codex endpoints.
/// </summary>
public sealed class OfferAdvice
{
    public required string Id;
    public required string DisplayName;
    public bool IsRelic;
    /// <summary>Relic offered through an event option button (Neow etc.).</summary>
    public bool IsEventOption;
    /// <summary>Option is in the ancient's cursed pool (loc key contains CURSED).</summary>
    public bool IsCursed;

    public int? AdviceRank;
    public double? AdviceScore;
    public double? AdviceBase;
    public List<DraftReason> Reasons = new();

    /// <summary>Relic offers: names of held cards that pair with this relic.</summary>
    public List<string> PairNames = new();

    public double? CoachScore;
    public double? CommitmentDelta;
    public double? WinnerSupport;

    public MetricRow? Metrics;
}

/// <summary>Godot presentation target paired with its scene-tree-independent advice data.</summary>
public sealed class OfferView
{
    public required Control Node;
    public required OfferAdvice Advice;
}

/// <summary>
/// Drives the whole flow for one open selection screen:
/// scan offered cards → snapshot deck → fetch Codex data → render overlay.
///
/// Threading: everything that touches the Godot scene tree runs on the main
/// thread (deferred callables). Only the HTTP fetch hops to Task.Run.
/// A generation counter drops stale results after close/refresh.
/// </summary>
public static class AdviceFlow
{
    private static readonly ScreenSessionState Session = new();

    /// <summary>Called from Harmony postfix when a selection screen opens or refreshes.</summary>
    public static void OnScreenOpened(Node screen)
    {
        var gen = Session.Open(screen, out var cancellationToken);
        RunSafely(() => Callable.From(() => RunSafely(
            () => TryScan(screen, gen, 0, cancellationToken), "deferred scan callback")).CallDeferred(),
            "deferred scan scheduling");
    }

    /// <summary>Called from Harmony postfix when a selection screen closes.</summary>
    public static void OnScreenClosed(Node screen)
    {
        // Publish the cleared state only when the screen that actually owned
        // this session closed; unrelated close events leave the overlay state
        // and the run snapshot untouched.
        if (!Session.Close(screen)) return;
        try
        {
            var snapshot = RunInspector.Capture();
            if (snapshot != null)
                OverlayBridge.PublishState("none", snapshot, Array.Empty<OfferAdvice>());
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] overlay publish failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Content of the tracked screen changed (e.g. a merchant slot refilled).
    /// No-op before the first screen open.
    /// </summary>
    public static void OnContentChanged()
    {
        if (!Session.TryGetCurrentScreen(out var screen)) return;
        OnScreenOpened(screen);
    }

    /// <summary>
    /// Scene-tree polling on the main thread via SceneTree timers (no reliance on a
    /// SynchronizationContext); HTTP runs on a thread-pool task and the result is
    /// marshalled back with CallDeferred.
    /// </summary>
    private static void TryScan(Node screen, int gen, int attempt, CancellationToken cancellationToken)
    {
        try
        {
            if (!Session.IsCurrent(screen, gen)) return;

            var views = OfferCandidateScanner.Scan(screen);
            if (views.Count == 0)
            {
                // Some screens populate their cards asynchronously — retry briefly.
                if (attempt < 6 && Engine.GetMainLoop() is SceneTree tree)
                {
                    var timer = tree.CreateTimer(attempt == 0 ? 0.05 : 0.25);
                    timer.Timeout += () => RunSafely(
                        () => TryScan(screen, gen, attempt + 1, cancellationToken), "timer callback");
                    return;
                }
                Log.Error("[DraftAdvisor] no offered cards found on screen");
                return;
            }

            var snap = RunInspector.Capture();
            if (snap == null || snap.HeldItems.Count == 0)
            {
                Log.Error("[DraftAdvisor] deck snapshot unavailable");
                return;
            }

            var offers = views.Select(v => v.Advice).ToList();
            OverlayBridge.PublishState(screen.GetType().Name, snap, offers);
            var offeredCardIds = offers.Where(o => !o.IsRelic).Select(o => o.Id).ToList();
            // Pairings are fetched once per distinct relic id; duplicates share advice.
            var distinctRelicIds = offers.Where(o => o.IsRelic).Select(o => o.Id)
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            // Codex acquisition runs on a background thread; no Godot objects
            // are passed to or accessed by the fetch service.
            _ = Task.Run(async () =>
            {
                try
                {
                    var result = await CodexAdviceFetchService.FetchAsync(
                        snap.Character, snap.DeckCardIds, snap.RelicIds, snap.HeldItems,
                        offeredCardIds, distinctRelicIds, cancellationToken).ConfigureAwait(false);

                    Callable.From(() => RunSafely(() =>
                    {
                        if (!Session.IsCurrent(screen, gen)) return;
                        AdviceMerger.MergeAdvice(offers, result.Advice, result.Coach, result.CardMetrics);
                        AdviceMerger.MergeRelicAdvice(offers, result.RelicIds, result.RelicMetrics,
                            result.RelicPairings, snap);
                        AdvisorUi.Render(
                            screen, views, snap.ItemNames,
                            result.Coach?.Target?.Name, result.Coach?.Target?.Similarity ?? 0);
                    }, "deferred result callback")).CallDeferred();
                }
                catch (Exception ex)
                {
                    if (ex is OperationCanceledException && cancellationToken.IsCancellationRequested)
                        return;
                    Log.Error($"[DraftAdvisor] background Codex fetch failed: {ex.Message}");
                }
            });
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] pipeline failed: {ex.Message}");
        }
    }

    private static void RunSafely(Action action, string context)
    {
        try
        {
            action();
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] {context} failed: {ex.Message}");
        }
    }

}

/// <summary>
/// Owns the lifecycle state for the currently advised screen. Every open or
/// close advances the generation so deferred scans and fetch results from an
/// earlier screen session are ignored.
/// </summary>
internal sealed class ScreenSessionState
{
    private volatile int _generation;
    private Node? _currentScreen;
    private CancellationTokenSource? _fetchCancellation;

    public int Open(Node screen, out CancellationToken cancellationToken)
    {
        _fetchCancellation?.Cancel();
        _fetchCancellation = new CancellationTokenSource();
        cancellationToken = _fetchCancellation.Token;
        _currentScreen = screen;
        var generation = ++_generation;
        AdvisorUi.Clear();
        return generation;
    }

    /// <summary>Returns true when the closed screen owned the active session.</summary>
    public bool Close(Node screen)
    {
        // Several nested selection and event nodes can close during one flow.
        // Only the screen currently supplying advice may invalidate that session.
        if (!ReferenceEquals(_currentScreen, screen)) return false;
        _fetchCancellation?.Cancel();
        _fetchCancellation = null;
        _generation++;
        _currentScreen = null;
        AdvisorUi.Clear();
        return true;
    }

    public bool TryGetCurrentScreen(out Node screen)
    {
        screen = _currentScreen!;
        return screen != null && GodotObject.IsInstanceValid(screen);
    }

    public bool IsCurrent(Node screen, int generation)
        => generation == _generation && GodotObject.IsInstanceValid(screen);
}
