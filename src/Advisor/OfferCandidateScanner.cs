using DraftAdvisor.Game;
using Godot;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Nodes.Cards;
using MegaCrit.Sts2.Core.Nodes.Cards.Holders;
using MegaCrit.Sts2.Core.Nodes.Events;
using MegaCrit.Sts2.Core.Nodes.Relics;

namespace DraftAdvisor.Advisor;

/// <summary>Finds card and relic candidates on a selection screen.</summary>
public static class OfferCandidateScanner
{
    /// <summary>Find offered cards and relics anywhere under the screen node.</summary>
    public static List<OfferView> Scan(Node screen)
    {
        var cards = new List<(Control node, CardModel model)>();
        var relics = new List<(Control node, RelicModel model)>();
        FindOffersInTree(screen, cards, relics, 0);

        // Dedupe by node, not by id: the same card id can legitimately appear
        // in multiple slots (e.g. two copies for sale) and each needs a badge.
        // Holder/inner-child double-counting is prevented by FindOffersInTree
        // not recursing into matched holders.
        var offers = new List<OfferView>();
        var seen = new HashSet<Control>();
        foreach (var (node, model) in cards)
        {
            if (!seen.Add(node)) continue;
            var id = RunInspector.NormalizeId(ModelAccess.EntryOf(model));
            if (string.IsNullOrEmpty(id)) continue;
            offers.Add(new OfferView
            {
                Node = node,
                Advice = new OfferAdvice
                {
                    Id = id,
                    DisplayName = ModelAccess.SafeTitle(model) ?? DisplayNameFormatter.Prettify(id),
                },
            });
        }
        foreach (var (node, model) in relics)
        {
            if (!seen.Add(node)) continue;
            var id = RunInspector.NormalizeId(ModelAccess.EntryOf(model));
            if (string.IsNullOrEmpty(id)) continue;
            offers.Add(new OfferView
            {
                Node = node,
                Advice = new OfferAdvice
                {
                    Id = id,
                    DisplayName = ModelAccess.SafeTitle(model) ?? DisplayNameFormatter.Prettify(id),
                    IsRelic = true,
                    IsEventOption = node is NEventOptionButton,
                    IsCursed = node is NEventOptionButton b &&
                        (b.Option?.Description?.LocEntryKey?.Contains("CURSED") ?? false),
                },
            });
        }
        return offers;
    }

    private static void FindOffersInTree(
        Node parent,
        List<(Control, CardModel)> cards,
        List<(Control, RelicModel)> relics,
        int depth)
    {
        if (depth > 15) return;
        foreach (var child in parent.GetChildren())
        {
            if (child == null) continue;
            // Event option buttons (Neow, shrine relics...): badge the button,
            // don't recurse — the relic icon child would be scanned twice.
            if (child is NEventOptionButton optionButton && optionButton.Option?.Relic != null)
            {
                relics.Add((optionButton, optionButton.Option.Relic));
                continue;
            }
            if (child is NCardHolder holder && holder.CardModel != null)
            {
                cards.Add((holder, holder.CardModel));
                continue;
            }
            if (child is NCard card && card.Model != null)
            {
                cards.Add((card, card.Model));
                continue;
            }
            // NRelicBasicHolder wraps an NRelic child: prefer the holder (better
            // anchor) and do NOT recurse into it, else the same relic is scanned twice.
            if (child is NRelicBasicHolder relicHolder && relicHolder.Relic?.Model != null)
            {
                relics.Add((relicHolder, relicHolder.Relic.Model));
                continue;
            }
            if (child is NRelic relic && relic.Model != null)
            {
                relics.Add((relic, relic.Model));
                continue;
            }
            FindOffersInTree(child, cards, relics, depth + 1);
        }
    }
}
