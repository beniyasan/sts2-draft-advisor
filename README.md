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

**Event option buttons** (Neow's blessings and any other event option
that grants a relic) get the relic overlay docked to the right edge of
the button, ranked against each other by score. Options in the ancient's
cursed pool are marked `CURSE` in red (detected from the option's
loc key).

No manual input needed: the mod reads your deck, relics and the offered
cards straight from the running game.

## Screens covered

- Post-combat card reward screen (`NCardRewardSelectionScreen`)
- "Choose a card" screens (`NChooseACardSelectionScreen`)
- "Choose a relic" screens (`NChooseARelicSelection`)
- Merchant shop (`NMerchantInventory`) — badges under each card/relic for sale
- Event screens (`NEventLayout`, incl. Neow) — badges on any option
  button that grants a relic

## Install

1. Build (see below) or download a release `DraftAdvisor.dll`.
2. Create folder `Slay the Spire 2/mods/DraftAdvisor/` inside your game
   install directory.
3. Copy `DraftAdvisor.dll` and `DraftAdvisor.json` into it.
4. Launch the game → Settings → Modding → enable *Draft Advisor* → restart.

## Chat overlay (Windows)

The mod can stream the current deck, relics and offered cards to the optional
Electron companion overlay. The overlay displays a transparent chat window and
a replaceable Live2D placeholder, and sends Japanese deck/card questions to
Codex App Server with Spire Codex context.

1. Install Node.js 22+ and the Codex CLI, then complete the Codex/ChatGPT login
   once in the companion app.
2. Build the overlay:

   ```bash
   cd overlay
   npm install
   npm run build
   npm start
   ```

3. Start the game with the Draft Advisor MOD enabled. The overlay opens visibly.
   Press `Ctrl+Shift+D` to minimize or restore it; if the desktop cannot register
   that shortcut, use its taskbar button. `更新` requests the latest state from
   the MOD.

The overlay prefers `gpt-6-luna` when the connected Codex App Server reports it
through `model/list`. Set `CODEX_BIN` if the `codex` executable is not on PATH.
The game MOD and overlay communicate only through the local
`DraftAdvisor.v1` named pipe. No OpenAI credential is stored in the game MOD.

Live2D model files are intentionally not bundled. When a licensed Cubism model
is available, replace the placeholder through the `Live2DAdapter` boundary in
`overlay/src/renderer/live2d.ts`.

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
  `NCard` (cards), `NRelic` / `NRelicBasicHolder` (relics) and
  `NEventOptionButton` nodes carrying `Option.Relic`
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
- Neow recommendations are a proxy: spire-codex has no per-Neow-option
  stats, so each option is scored by the relic it grants.
- Requires internet on first reward screen (metrics table is cached
  for 30 min afterwards).
