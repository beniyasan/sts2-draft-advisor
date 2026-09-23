using Godot;

namespace DraftAdvisor.UI;

/// <summary>
/// Badge root attached as a child of its offer node, so node transforms and
/// hover/fan-in animations carry it automatically. _Process keeps it anchored
/// to the node's local rect (top edge above cards/relics, right edge of
/// event option buttons) and counter-scales so label text stays screen-size.
/// Hidden while the target's rect is degenerate (not laid out yet); after 1.5s
/// gives up and anchors to a nominal card/option-sized rect instead.
/// </summary>
public sealed class AnchoredBadge : Control
{
    public Control? Target;
    public bool EventOption;
    public bool IsRelic;
    public float BadgeWidth = 240f;

    private bool _measured;
    private bool _usingFallback;
    private double _degenerateSeconds;

    public override void _Process(double delta)
    {
        if (Target == null || !GodotObject.IsInstanceValid(Target))
        {
            QueueFree();
            return;
        }

        var rect = new Rect2(Vector2.Zero, Target.Size);
        if (rect.Size.X < 20f || rect.Size.Y < 20f)
        {
            _degenerateSeconds += delta;
            if (_degenerateSeconds <= 1.5)
            {
                Visible = false;
                return;
            }
            // Give up waiting for layout: nominal rect in the node's local
            // space so the anchor math still lands the badge near the offer.
            rect = EventOption
                ? new Rect2(new Vector2(-400f, 0f), new Vector2(400f, 80f))
                : new Rect2(new Vector2(-120f, -210f), new Vector2(240f, 420f));
            _usingFallback = true;
        }
        else
        {
            _degenerateSeconds = 0;
            // A real rect arrived after a fallback measurement — remeasure so
            // child widths track the item's true size.
            if (_usingFallback)
            {
                _usingFallback = false;
                _measured = false;
            }
        }

        Visible = true;

        // Children are authored in screen px; undo the target's global scale.
        var gt = Target.GetGlobalTransform();
        var gsX = gt.X.Length();
        var gsY = gt.Y.Length();
        var sx = gsX > 0.01f ? 1f / gsX : 1f;
        var sy = gsY > 0.01f ? 1f / gsY : 1f;
        Scale = new Vector2(sx, sy);

        if (!_measured)
        {
            _measured = true;
            BadgeWidth = BadgeLayout.GetWidth(rect.Size.X, gsX, EventOption, IsRelic);
            var lx = BadgeLayout.GetLeft(EventOption, BadgeWidth);
            var i = 0;
            foreach (var child in GetChildren())
            {
                if (child is not Control c) continue;
                // Non-event badges stack upward from the top-edge anchor.
                var y = BadgeLayout.GetRowY(EventOption, i);
                c.Position = new Vector2(lx, y);
                c.Size = new Vector2(BadgeWidth, c.Size.Y);
                i++;
            }
        }

        // Anchor in the TARGET's local space (badge is its child): centered
        // just ABOVE the item's top edge, or inside the option button's right
        // edge. Above keeps the badge off the card art and its type banner.
        Position = EventOption
            ? rect.Position + new Vector2(rect.Size.X - 10f * sx, 8f * sy)
            : rect.Position + new Vector2(rect.Size.X / 2f, -6f * sy);
    }
}
