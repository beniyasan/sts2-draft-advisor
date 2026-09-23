using System.Reflection;
using MegaCrit.Sts2.Core.Models;

namespace DraftAdvisor.Game;

/// <summary>Safe access to model identifiers and display titles.</summary>
public static class ModelAccess
{
    /// <summary>Returns the model ID entry, or null when the model cannot expose it.</summary>
    public static string? EntryOf(AbstractModel model)
    {
        try { return model.Id.Entry; } catch { return null; }
    }

    /// <summary>Returns a plain or localized title, or null when it cannot be read.</summary>
    public static string? SafeTitle(AbstractModel model)
    {
        try
        {
            var titleProp = model.GetType().GetProperty("Title",
                BindingFlags.Public | BindingFlags.Instance);
            var v = titleProp?.GetValue(model);
            if (v == null) return null;
            if (v is string s) return s;
            var fmt = v.GetType().GetMethod("GetFormattedText",
                BindingFlags.Public | BindingFlags.Instance,
                Type.EmptyTypes);
            if (fmt?.Invoke(v, null) is string fs) return fs;
            return v.ToString();
        }
        catch { return null; }
    }

    public static bool IsUpgraded(AbstractModel model)
    {
        try
        {
            var type = model.GetType();
            var flag = type.GetProperty("IsUpgraded", BindingFlags.Public | BindingFlags.Instance)?.GetValue(model);
            if (flag is bool upgraded) return upgraded;
            var level = (type.GetProperty("UpgradeLevel", BindingFlags.Public | BindingFlags.Instance)
                ?? type.GetProperty("CurrentUpgradeLevel", BindingFlags.Public | BindingFlags.Instance))
                ?.GetValue(model);
            return level is int n && n > 0;
        }
        catch { return false; }
    }
}
