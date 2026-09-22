using Godot;

namespace DraftAdvisor.UI;

/// <summary>
/// Badge root that re-anchors to its offer node's global rect every frame, so
/// hover/fan-in animations never leave the advice floating away from the card.
/// Hidden while the target's rect is degenerate (not laid out yet); gives up
/// after ~1.5s and falls back to the node's origin.
/// </summary>
public sealed class AnchoredBadge : Control
{
    public Control? Target;
    public bool EventOption;
    public bool IsRelic;
    public float BadgeWidth = 240f;

    private bool _measured;
    private int _degenerateTicks;

    public override void _Process(double delta)
    {
        if (Target == null || !GodotObject.IsInstanceValid(Target))
        {
            QueueFree();
            return;
        }

        var rect = Target.GetGlobalRect();
        if (rect.Size.X < 20f || rect.Size.Y < 20f)
        {
            if (++_degenerateTicks > 90)
            {
                Visible = true;
                GlobalPosition = Target.GlobalPosition;
            }
            else
            {
                Visible = false;
            }
            return;
        }

        Visible = true;
        if (!_measured)
        {
            _measured = true;
            BadgeWidth = EventOption
                ? 300f
                : Mathf.Clamp(rect.Size.X * (IsRelic ? 2f : 1f), 150f, 320f);
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

        GlobalPosition = EventOption
            ? new Vector2(rect.End.X - 10f, rect.Position.Y + 8f)
            : new Vector2(rect.Position.X + rect.Size.X / 2f, rect.End.Y + 4f);
    }
}
