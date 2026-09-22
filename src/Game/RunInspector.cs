using System.Reflection;
using Godot;
using MegaCrit.Sts2.Core.Entities.Players;
using MegaCrit.Sts2.Core.Logging;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Runs;

namespace DraftAdvisor.Game;

/// <summary>
/// Reads the live run state (current deck, relics, character) from the scene tree.
/// Access path: scene root → "Run" node → private `_state` field → RunState → Players.
/// </summary>
public static class RunInspector
{
    public sealed class Snapshot
    {
        public string Character { get; set; } = "ironclad";
        public List<string> DeckCardIds { get; } = new();
        public List<string> RelicIds { get; } = new();
        /// <summary>Items for the draft-advice API: "cards:ID" / "relics:ID".</summary>
        public List<string> HeldItems { get; } = new();
        /// <summary>"cards:ID" / "relics:ID" → localized display name (for reason text).</summary>
        public Dictionary<string, string> ItemNames { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Most recent player seen; falls back to scene-tree lookup.</summary>
    private static Player? _lastPlayer;

    public static Snapshot? Capture()
    {
        try
        {
            var player = _lastPlayer ?? FindPlayer();
            if (player == null)
            {
                Log.Error("[DraftAdvisor] no Player found (not in a run?)");
                return null;
            }
            _lastPlayer = player;

            var snap = new Snapshot();

            foreach (var card in player.Deck.Cards)
            {
                var id = NormalizeId(EntryOf(card));
                if (string.IsNullOrEmpty(id)) continue;
                snap.DeckCardIds.Add(id);
                snap.HeldItems.Add($"cards:{id}");
                var title = SafeTitle(card);
                if (!string.IsNullOrEmpty(title))
                    snap.ItemNames[$"cards:{id}"] = title;
            }

            foreach (var relic in player.Relics)
            {
                var id = NormalizeId(EntryOf(relic));
                if (string.IsNullOrEmpty(id)) continue;
                snap.RelicIds.Add(id);
                snap.HeldItems.Add($"relics:{id}");
                var title = SafeTitle(relic);
                if (!string.IsNullOrEmpty(title))
                    snap.ItemNames[$"relics:{id}"] = title;
            }

            snap.Character = ResolveCharacter(player);
            return snap;
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] Capture failed: {ex.Message}");
            return null;
        }
    }

    private static string? EntryOf(AbstractModel model)
    {
        try { return model.Id.Entry; } catch { return null; }
    }

    /// <summary>Convert a model Id.Entry into the spire-codex id form (uppercase, no CARD_ prefix).</summary>
    public static string? NormalizeId(string? entry)
    {
        if (string.IsNullOrEmpty(entry)) return null;
        var s = entry.Trim();
        if (s.StartsWith("CARD_", StringComparison.OrdinalIgnoreCase))
            s = s.Substring(5);
        if (s.StartsWith("RELIC_", StringComparison.OrdinalIgnoreCase))
            s = s.Substring(6);
        return s.ToUpperInvariant();
    }

    private static Player? FindPlayer()
    {
        try
        {
            if (Engine.GetMainLoop() is not SceneTree tree) return null;
            var nRun = tree.Root?.FindChild("Run", recursive: true, owned: false);
            if (nRun == null) return null;

            var stateField = nRun.GetType().GetField("_state",
                BindingFlags.NonPublic | BindingFlags.Instance);
            if (stateField?.GetValue(nRun) is not RunState runState) return null;

            // Prefer the local player in co-op; fall back to the first player.
            foreach (var p in runState.Players)
            {
                try
                {
                    var prop = p.GetType().GetProperty("IsLocal",
                            BindingFlags.Public | BindingFlags.Instance)
                        ?? p.GetType().GetProperty("IsLocalPlayer",
                            BindingFlags.Public | BindingFlags.Instance);
                    if (prop?.GetValue(p) is true) return p;
                }
                catch { }
            }
            return runState.Players.Count > 0 ? runState.Players[0] : null;
        }
        catch (Exception ex)
        {
            Log.Error($"[DraftAdvisor] FindPlayer failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>Title is a string on cards but a LocString on relics.</summary>
    private static string? SafeTitle(AbstractModel model)
    {
        try
        {
            var v = model.GetType().GetProperty("Title",
                    BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(model);
            if (v == null) return null;
            if (v is string s) return s;
            var fmt = v.GetType().GetMethod("GetFormattedText",
                BindingFlags.Public | BindingFlags.Instance, Type.EmptyTypes);
            if (fmt?.Invoke(v, null) is string fs) return fs;
            return v.ToString();
        }
        catch { return null; }
    }

    private static string ResolveCharacter(Player player)
    {
        // Character ids used by the API: ironclad, silent, defect, necrobinder, regent.
        try
        {
            var entry = player.Character?.Id.Entry?.ToLowerInvariant();
            if (entry is "ironclad" or "silent" or "defect" or "necrobinder" or "regent")
                return entry;
        }
        catch { }

        // Fallback: infer from card pools in the deck (model.Pool.Title).
        try
        {
            foreach (var card in player.Deck.Cards)
            {
                var title = card.Pool?.Title?.ToLowerInvariant();
                if (title is "ironclad" or "silent" or "defect" or "necrobinder" or "regent")
                    return title;
            }
        }
        catch { }

        return "ironclad";
    }
}
