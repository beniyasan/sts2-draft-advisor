// Minimal compile-time stubs for MegaCrit.Sts2.Core types.
// These exist ONLY so the mod compiles without the real sts2.dll.
// Member shapes mirror the real game DLL (verified via decompilation);
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
        public string Category { get; set; } = "";
        public string Entry { get; set; } = "";
    }

    public abstract class AbstractModel
    {
        public ModelId Id { get; set; } = new();
    }

    public class CardPoolModel : AbstractModel
    {
        public string Title { get; set; } = "";
    }

    public class CardModel : AbstractModel
    {
        public string Title { get; set; } = "";
        public CardPoolModel? Pool { get; set; }
    }

    public class CharacterModel : AbstractModel { }

    public enum RelicRarity { Common, Uncommon, Rare }

    public class RelicModel : AbstractModel
    {
        public object? Title { get; set; }
        public RelicRarity Rarity { get; set; }
    }
}

namespace MegaCrit.Sts2.Core.Entities.Cards
{
    using MegaCrit.Sts2.Core.Models;

    public class CardPile
    {
        public IReadOnlyList<CardModel> Cards { get; } = new List<CardModel>();
    }
}

namespace MegaCrit.Sts2.Core.Entities.Players
{
    using MegaCrit.Sts2.Core.Entities.Cards;
    using MegaCrit.Sts2.Core.Models;

    public class Player
    {
        public CardPile Deck { get; } = new();
        public IReadOnlyList<RelicModel> Relics { get; } = new List<RelicModel>();
        public CharacterModel? Character { get; set; }
        public object? PlayerCombatState { get; set; }
    }
}

namespace MegaCrit.Sts2.Core.Runs
{
    using MegaCrit.Sts2.Core.Entities.Players;

    public class RunState
    {
        public IReadOnlyList<Player> Players { get; } = new List<Player>();
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

namespace MegaCrit.Sts2.Core.Nodes.Relics
{
    using MegaCrit.Sts2.Core.Models;

    public class NRelic : Control
    {
        public RelicModel? Model { get; set; }
    }

    public class NRelicBasicHolder : Control
    {
        public NRelic? Relic { get; set; }
    }
}

namespace MegaCrit.Sts2.Core.Nodes.Screens
{
    public class NChooseARelicSelection : Control
    {
        public void AfterOverlayOpened() { }
        public void AfterOverlayClosed() { }
    }

    namespace CardSelection
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

    namespace Shops
    {
        public class NMerchantInventory : Control
        {
            public void Open() { }
            public void Close() { }
        }
    }
}
