using DraftAdvisor.Advisor;
using Godot;
using MegaCrit.Sts2.Core.Logging;

namespace DraftAdvisor.UI;

/// <summary>
/// Builds the overlay: per-offer badges (tier chip + info strip under each card)
/// and one archetype chip at the top of the selection screen.
/// All nodes are named DraftAdvisor* so they can be cleaned up reliably.
/// </summary>
public static class AdvisorUi
{
    private static readonly List<Node> _nodes = new();

    private static readonly Dictionary<string, Color> TierColors = new()
    {
        ["S"] = new Color("ff8000"), ["A"] = new Color("a335ee"),
        ["B"] = new Color("0070dd"), ["C"] = new Color("1eff00"),
        ["D"] = new Color("9d9d9d"), ["F"] = new Color("9d9d9d"),
        ["?"] = new Color("666666"),
    };

    private static readonly Color[] RankColors =
    {
        new Color("e3b343"), // #1 gold
        new Color("b7b7b7"), // #2 silver
        new Color("b08d57"), // #3 bronze
        new Color("777777"),
    };

    public static void Render(
        Node screen,
        IReadOnlyList<OfferAdvice> offers,
        IReadOnlyDictionary<string, string> heldNames,
        string? archetypeName,
        double archetypeSimilarity)
    {
        // Badges are children of their offer nodes (auto-follow + auto-free);
        // the archetype chip sits on a CanvasLayer in viewport coords.
        var tree = screen.GetTree();
        if (tree == null) return;
        var layer = new CanvasLayer { Name = "DraftAdvisorOverlay" };
        tree.Root.AddChild(layer);
        _nodes.Add(layer);

        foreach (var offer in offers)
        {
            if (!GodotObject.IsInstanceValid(offer.Node)) continue;
            var badge = BuildOfferBadge(offer, heldNames);
            if (badge != null)
            {
                offer.Node.AddChild(badge);
                _nodes.Add(badge);
            }
        }

        if (!string.IsNullOrEmpty(archetypeName) && screen is Control ctrl)
        {
            var chip = BuildArchetypeChip(ctrl, archetypeName, archetypeSimilarity);
            if (chip != null)
            {
                layer.AddChild(chip);
            }
        }
    }

    public static void Clear()
    {
        foreach (var n in _nodes)
        {
            try
            {
                if (GodotObject.IsInstanceValid(n)) n.QueueFree();
            }
            catch { }
        }
        _nodes.Clear();
    }

    /// <summary>
    /// Badge anchored to the offer node's real screen rect (GetGlobalRect):
    /// centered under cards/relics, docked at the right edge of event buttons.
    /// </summary>
    private static Control? BuildOfferBadge(
        OfferAdvice offer, IReadOnlyDictionary<string, string> heldNames)
    {
        try
        {
            // AnchoredBadge re-anchors inside the offer node's local space;
            // children are authored in screen px, counter-scaled at runtime.
            var gsX = offer.Node.GetGlobalTransform().X.Length();
            var bw = offer.IsEventOption
                ? 300f
                : offer.Node.Size.X < 20f
                    ? 240f
                    : Mathf.Clamp(offer.Node.Size.X * gsX * (offer.IsRelic ? 2f : 1f), 150f, 320f);
            var root = new AnchoredBadge
            {
                Name = "DraftAdvisorBadge",
                MouseFilter = Control.MouseFilterEnum.Ignore,
                Target = offer.Node,
                EventOption = offer.IsEventOption,
                IsRelic = offer.IsRelic,
                BadgeWidth = bw,
            };

            // Event options anchor at the button's right edge (children extend
            // left); cards/relics anchor above the top edge, stacking upward
            // (matches AnchoredBadge's runtime layout pass).
            var lx = offer.IsEventOption ? -bw : -bw / 2f;
            var (x1, y1, w1) = offer.IsEventOption ? (lx, 0f, bw) : (lx, -52f, bw);
            var (x2, y2, w2) = offer.IsEventOption ? (lx, 17f, bw) : (lx, -35f, bw);
            var (x3, y3, w3) = offer.IsEventOption ? (lx, 34f, bw) : (lx, -18f, bw);

            // --- Rank / context score line ---
            var line1 = new Label { MouseFilter = Control.MouseFilterEnum.Ignore };
            var rankTxt = offer.AdviceRank is int r && r <= RankColors.Length
                ? $"#{r}  "
                : "";
            var fitTxt = offer.IsRelic
                ? offer.Metrics is { Score: > 0 } ms
                    ? $"Score {ms.Score:0}"
                    : ""
                : offer.AdviceScore is double sc && sc > 0
                    ? $"Fit {(int)Math.Round(sc * 100)}%"
                    : offer.CoachScore is double cs && cs > 0
                        ? $"Coach {(int)Math.Round(cs)}"
                        : "";
            line1.Text = $"{(offer.IsCursed ? "CURSE  " : "")}{rankTxt}{fitTxt}";
            line1.AddThemeFontSizeOverride("font_size", 17);
            line1.AddThemeColorOverride("font_color",
                offer.IsCursed ? new Color("ff5555") : RankColor(offer.AdviceRank));
            line1.AddThemeColorOverride("font_outline_color", new Color(0f, 0f, 0f));
            line1.AddThemeConstantOverride("outline_size", 6);
            line1.HorizontalAlignment = offer.IsEventOption
                ? HorizontalAlignment.Right
                : HorizontalAlignment.Center;
            line1.Position = new Vector2(x1, y1);
            line1.Size = new Vector2(w1, 22);
            root.AddChild(line1);

            // --- Metrics line: tier · pick% · win% ---
            var m = offer.Metrics;
            var line2 = new Label { MouseFilter = Control.MouseFilterEnum.Ignore };
            if (m != null)
            {
                var win = $"{m.WinRate:0}%";
                line2.Text = m.PickRate is double pr
                    ? $"{m.Tier} · Pick {pr:0}% · Win {win}"
                    : $"{m.Tier} · Win {win}";
                line2.AddThemeColorOverride("font_color", TierColors.GetValueOrDefault(m.Tier, TierColors["?"]));
            }
            else
            {
                line2.Text = "no data";
                line2.AddThemeColorOverride("font_color", new Color(0.6f, 0.6f, 0.6f));
            }
            line2.AddThemeFontSizeOverride("font_size", 13);
            line2.AddThemeColorOverride("font_outline_color", new Color(0f, 0f, 0f));
            line2.AddThemeConstantOverride("outline_size", 5);
            line2.HorizontalAlignment = offer.IsEventOption
                ? HorizontalAlignment.Right
                : HorizontalAlignment.Center;
            line2.Position = new Vector2(x2, y2);
            line2.Size = new Vector2(w2, 18);
            root.AddChild(line2);

            // --- Reason line: held items driving this pick ---
            var reason = TopReasonText(offer, heldNames);
            if (reason != null)
            {
                var line3 = new Label { MouseFilter = Control.MouseFilterEnum.Ignore };
                line3.Text = reason;
                line3.AddThemeFontSizeOverride("font_size", 11);
                line3.AddThemeColorOverride("font_color", new Color(0.85f, 0.78f, 0.6f));
                line3.AddThemeColorOverride("font_outline_color", new Color(0f, 0f, 0f));
                line3.AddThemeConstantOverride("outline_size", 4);
                line3.HorizontalAlignment = offer.IsEventOption
                    ? HorizontalAlignment.Right
                    : HorizontalAlignment.Center;
                line3.Position = new Vector2(x3, y3);
                line3.Size = new Vector2(w3, 16);
                root.AddChild(line3);
            }

            return root;
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] BuildOfferBadge({offer.Id}): {ex.Message}");
            return null;
        }
    }

    /// <summary>Cards: "pairs: Setup Strike ×3.0". Relics: "pairs: Mad Science".</summary>
    private static string? TopReasonText(
        OfferAdvice offer, IReadOnlyDictionary<string, string> heldNames)
    {
        if (offer.IsRelic)
        {
            return offer.PairNames.Count == 0
                ? null
                : $"pairs: {string.Join(" · ", offer.PairNames)}";
        }
        if (offer.Reasons.Count == 0) return null;
        var parts = new List<string>();
        foreach (var r in offer.Reasons.Take(2))
        {
            var name = heldNames.TryGetValue(r.From, out var n)
                ? n
                : AdviceFlow.Prettify(r.From.Contains(':')
                    ? r.From[(r.From.IndexOf(':') + 1)..]
                    : r.From);
            parts.Add($"{name} ×{r.Lift:0.#}");
        }
        return $"pairs: {string.Join(" · ", parts)}";
    }

    private static Color RankColor(int? rank) =>
        rank is int r && r >= 1 && r <= RankColors.Length ? RankColors[r - 1] : RankColors[^1];

    /// <summary>Archetype chip centered at the top of the screen.</summary>
    private static Control? BuildArchetypeChip(Control screen, string name, double similarity)
    {
        try
        {
            var panel = new PanelContainer { Name = "DraftAdvisorArchetype", MouseFilter = Control.MouseFilterEnum.Ignore };
            var style = new StyleBoxFlat
            {
                BgColor = new Color(0.08f, 0.07f, 0.06f, 0.85f),
                BorderColor = new Color(0.45f, 0.35f, 0.2f),
                CornerRadiusBottomLeft = 8,
                CornerRadiusBottomRight = 8,
                CornerRadiusTopLeft = 8,
                CornerRadiusTopRight = 8,
            };
            style.BorderWidthBottom = 1; style.BorderWidthTop = 1;
            style.BorderWidthLeft = 1; style.BorderWidthRight = 1;
            style.ContentMarginLeft = 14; style.ContentMarginRight = 14;
            style.ContentMarginTop = 6; style.ContentMarginBottom = 6;
            panel.AddThemeStyleboxOverride("panel", style);

            var label = new Label { MouseFilter = Control.MouseFilterEnum.Ignore };
            label.Text = $"Deck archetype: {name} ({similarity:0}%)";
            label.AddThemeFontSizeOverride("font_size", 14);
            label.AddThemeColorOverride("font_color", new Color(0.95f, 0.88f, 0.7f));
            panel.AddChild(label);

            // Center horizontally near the top of the screen.
            var width = screen.GetViewportRect().Size.X;
            panel.Position = new Vector2(Mathf.Max(0f, width / 2f - 200f), 64f);
            return panel;
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] BuildArchetypeChip: {ex.Message}");
            return null;
        }
    }
}
