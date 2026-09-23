using Godot;

namespace DraftAdvisor.IPC;

/// <summary>
/// Scene-tree node that detects the overlay toggle hotkey (Ctrl+Shift+D) inside
/// the game process. Listening in-game is more reliable than a global OS
/// shortcut, which the game window may not deliver to the overlay process.
/// </summary>
public sealed partial class OverlayHotkeyNode : Node
{
    public override void _Input(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Echo: false } key
            && key.Keycode == Key.D && key.CtrlPressed && key.ShiftPressed && !key.AltPressed)
        {
            OverlayBridge.SendToggle();
        }
    }
}
