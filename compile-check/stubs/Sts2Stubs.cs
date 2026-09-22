// Minimal compile-time stubs for MegaCrit.Sts2.Core types.
// These exist ONLY so the mod compiles without the real sts2.dll.
// Member shapes mirror the verified surface used by other StS2 mods;
// the real game DLL replaces all of this at build/runtime.

using Godot;

namespace MegaCrit.Sts2.Core.Logging
{
    public static class Log
    {
        public static void Info(string msg) { }
        public static void Error(string msg) { }
    }
}

namespace MegaCrit.Sts2.Core.Modding
{
    [AttributeUsage(AttributeTargets.Class)]
    public sealed class ModInitializerAttribute : Attribute
    {
        public ModInitializerAttribute(string initializerMethod) { }
    }
}

namespace MegaCrit.Sts2.Core.Models
{
    public sealed class ModelId
    {
        public string Entry { get; set; } = "";
    }

    public class CardPool
    {
        public string Title { get; set; } = "";
    }

    public class CardModel
    {
        public ModelId Id { get; set; } = new();
        public string Title { get; set; } = "";
        public CardPool? Pool { get; set; }
    }

    public enum RelicRarity { Common, Uncommon, Rare }

    public class RelicModel
    {
        public ModelId Id { get; set; } = new();
        public object? Title { get; set; }
        public RelicRarity Rarity { get; set; }
    }
}

namespace MegaCrit.Sts2.Core.Runs
{
    using MegaCrit.Sts2.Core.Models;

    public class CardPile
    {
        public IEnumerable<object?>? Cards { get; set; }
    }

    public class Player
    {
        public CardPile? Deck { get; set; }
        public IEnumerable<RelicModel> Relics { get; set; } = new List<RelicModel>();
        public object? CharacterType { get; set; }
        public object? PlayerCombatState { get; set; }
    }

    public class RunState
    {
        public List<Player> Players { get; } = new();
    }
}

namespace MegaCrit.Sts2.Core.Nodes.Cards
{
    using MegaCrit.Sts2.Core.Models;

    public class NCard : Control
    {
        public CardModel? Model { get; set; }
    }

    namespace Holders
    {
        public class NCardHolder : Control
        {
            public CardModel? CardModel { get; set; }
        }

        public class NGridCardHolder : NCardHolder { }
    }
}

namespace MegaCrit.Sts2.Core.Nodes.Screens.CardSelection
{
    public class NCardRewardSelectionScreen : Control
    {
        public void AfterOverlayOpened() { }
        public void AfterOverlayClosed() { }
        public void RefreshOptions() { }
    }

    public class NChooseACardSelectionScreen : Control
    {
        public void AfterOverlayOpened() { }
        public void AfterOverlayClosed() { }
    }
}
