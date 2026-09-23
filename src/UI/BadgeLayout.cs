using Godot;

namespace DraftAdvisor.UI;

/// <summary>Shared badge sizing and row placement rules.</summary>
internal static class BadgeLayout
{
    public static float GetWidth(
        float targetWidth, float globalScaleX, bool isEventOption, bool isRelic,
        float? degenerateWidth = null)
    {
        if (isEventOption) return 300f;
        if (degenerateWidth is float fallback) return fallback;

        return Mathf.Clamp(targetWidth * globalScaleX * (isRelic ? 2f : 1f), 150f, 320f);
    }

    public static float GetLeft(bool isEventOption, float width) =>
        isEventOption ? -width : -width / 2f;

    public static float GetRowY(bool isEventOption, int row) =>
        isEventOption ? row * 17f : -52f + row * 17f;
}
