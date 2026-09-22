# Draft Advisor — Slay the Spire 2 mod

Card-pick assistant for **Slay the Spire 2**. Whenever a card reward /
"choose a card" screen opens, the mod overlays community data from
[spire-codex.com](https://spire-codex.com) onto each offered card:

- **Fit %** — how often players holding a deck like yours took this card
  (from `POST /api/draft-advice`, trained on ~1.7M uploaded runs)
- **Rank chip** — `#1`/`#2`/`#3` ordering of the three offers
- **Tier · Pick% · Win%** — community metrics (`/api/runs/metrics/cards`)
- **Pairs** — which cards/relics already in your deck drive the pick
  (the API's `reasons` field, e.g. "pairs: Setup Strike ×3.0")
- **Deck archetype** — nearest community archetype for your current deck
  (`/api/runs/pick-coach`, e.g. "Iron Wave + Shrug It Off")

Offered **relics** get the same overlay treatment: `Score` (0–100
general rating) + `Tier · Win%` from `/api/runs/metrics/relics`, and a
`pairs:` line naming the held cards that pair best with the relic
(`/api/pairings/relics/{id}` intersected with your deck).

No manual input needed: the mod reads your deck, relics and the offered
cards straight from the running game.

## Screens covered

- Post-combat card reward screen (`NCardRewardSelectionScreen`)
- "Choose a card" screens (`NChooseACardSelectionScreen`)
- "Choose a relic" screens (`NChooseARelicSelection`)
- Merchant shop (`NMerchantInventory`) — badges under each card/relic for sale

## Install

1. Build (see below) or download a release `DraftAdvisor.dll`.
2. Create folder `Slay the Spire 2/mods/DraftAdvisor/` inside your game
   install directory.
3. Copy `DraftAdvisor.dll` and `DraftAdvisor.json` into it.
4. Launch the game → Settings → Modding → enable *Draft Advisor* → restart.

## Build

Requires .NET 9 SDK and three assemblies from your game install
(`Slay the Spire 2/data_sts2_<platform>_*64/`):

```
lib/
  sts2.dll
  GodotSharp.dll
  0Harmony.dll
```

`lib/` is gitignored — game DLLs are MegaCrit's assets and must never be
committed.

```bash
dotnet build -c Release
# output: bin/Release/net9.0/DraftAdvisor.dll
```

Or pass the data dir directly:

```bash
dotnet build -c Release -p:Sts2DataDir="C:/Program Files (x86)/Steam/steamapps/common/Slay the Spire 2/data_sts2_windows_x86_64"
```

## How it works

- `[ModInitializer]` entry point applies Harmony patches.
- Postfix patches on `AfterOverlayOpened` / `RefreshOptions` /
  `AfterOverlayClosed` of the selection screens drive an `AdviceFlow`.
- Offered items are found by scanning the screen for `NCardHolder` /
  `NCard` (cards) and `NRelic` / `NRelicBasicHolder` (relics) nodes
  (identity via `Model.Id.Entry`, e.g. `SHRUG_IT_OFF`).
- Deck and relics come from `NRun._state` → `RunState` → `Player.Deck`
  (same access path other StS2 mods use).
- API calls run off the UI thread; results render via `CallDeferred`.
- All Codex calls fail soft — offline play just shows no overlay.

## Data source

All stats come from the public [Spire Codex](https://spire-codex.com)
API (`/api/*`, no auth, CORS-open). Stats reflect runs uploaded by the
community — treat them as reference, not gospel.

## Notes / limitations

- Co-op: uses the local player's deck (falls back to `Players[0]`).
- Potion slots in the shop are not annotated.
- Requires internet on first reward screen (metrics table is cached
  for 30 min afterwards).
