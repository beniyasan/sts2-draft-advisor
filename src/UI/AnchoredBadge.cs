using Godot;

namespace DraftAdvisor.UI;

/// <summary>
/// Badge root attached as a child of its offer node, so node transforms and
/// hover/fan-in animations carry it automatically. _Process keeps it anchored
/// to the node's local rect (bottom-center under cards/relics, right edge of
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

        var rect = Target.GetRect();
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
            BadgeWidth = EventOption
                ? 300f
                : Mathf.Clamp(rect.Size.X * gsX * (IsRelic ? 2f : 1f), 150f, 320f);
            var lx = EventOption ? -BadgeWidth : -BadgeWidth / 2f;
            var i = 0;
            foreach (var child in GetChildren())
            {
                if (child is not Control c) continue;
                c.Position = new Vector2(lx, i == 0 ? 0f : i == 1 ? 18f : 34f);
                c.Size = new Vector2(BadgeWidth, c.Size.Y);
                i++;
            }
        }

        // Anchor in the TARGET's local space (badge is its child): bottom-center
        // under the item, or just inside the option button's right edge.
        Position = EventOption
            ? rect.Position + new Vector2(rect.Size.X - 10f * sx, 8f * sy)
            : rect.Position + new Vector2(rect.Size.X / 2f, rect.Size.Y + 4f * sy);
    }
}
