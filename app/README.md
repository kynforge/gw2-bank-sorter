# GW2 Companion

A personal helper for Guild Wars 2 that floats over the game. It reads your account through ArenaNet's official API and never changes anything there. The bank macro is the only part that touches the game, and it does one move per key press.

## What's in it

| Tab | What it does |
|-----|--------------|
| **Today** | World boss and meta timers for the next two hours, with waypoint codes to copy and paste into game chat. Events you haven't done today come first. Star events to get a desktop alert a few minutes before they start. Also shows which world bosses, meta chests and daily crafting you've done today, and your Wizard's Vault progress. |
| **Bank** | The cleanup planner from `gw2-bank-sorter.html`: what to deposit, use, sell, salvage or destroy, plus a suggested tab layout. It also checks crafting recipes before suggesting a destroy, flags high-value items, and shows "Used to craft" for any item. |
| **Find** | Searches every item on the account by name: bank, Material Storage, shared slots, every character's bags and gear, and the Legendary Armory. Also lists items spread across three or more characters. |
| **Builds** | A character's real stats from their equipped gear, and stat sets that suit a goal better (power, condition, hybrid, boon support or healing). Legendary gear is marked as a free swap. Import an Elite Insights JSON log to use your real Might and Fury uptimes. |
| **Macro** | While you hold a key, clears out what the cleanup plan sells into your bags, or tidies the bank into the suggested tabs. It scrolls the bank as needed and checks slot icons on screen before and after every move. Destroys are one press each and you confirm. |
| **Settings** | API key, theme and opacity, warning thresholds and hotkeys. |

## Before you start

- **Windows 10 or 11.**
- **Game display mode:** set Guild Wars 2 to **Windowed Fullscreen** or **Windowed**. In exclusive Fullscreen, the overlay can't draw on top.
- **API key:** create one at [account.arena.net/applications](https://account.arena.net/applications).
  - **account** and **inventories** are required.
  - **characters** and **builds** add bags and gear.
  - **unlocks** adds wardrobe checks.
  - **progression** adds collections and "done today".

## Hotkeys

| Keys | What they do |
|------|--------------|
| Ctrl+Shift+G | Show or hide the overlay |
| Ctrl+Shift+C | Let clicks pass through to the game (the overlay dims) |
| F7 | Macro: find the bank or bags under the pointer |
| F8 | Macro: hold to run, let go to stop (a tap does one step) |
| F9 | Macro: stop and disarm |
| F10 | Macro: type the item name into a destroy prompt (only within 20 seconds of a destroy step) |

The macro keys only work after you press Start in the Macro tab, and stop when you leave it. You can change any of these in Settings.

## Using the macro

1. **Clean up the plan first.** Do the cleanup plan in the Bank tab, wait a few minutes and press Refresh, so the API matches your bank.
2. **Open the bank and your inventory** in game. Make the bank window tall enough to show two tabs, so the macro can scroll.
3. **Find the windows.** In the Macro tab press **Start**.
   - Hover over the middle of the first slot of the top bank tab you can see and press **F7**.
   - Then do the same on the first slot of your inventory, or press "Skip" to work in the bank only.

   The app finds every slot by matching your item icons on screen. It works out the spacing, slots per row, the other tabs and which character you're on, then reports how many slots match.
4. **Pick a job.**
   - **Clear out for selling** takes what the cleanup plan deposits, uses, sells or salvages out of the bank and into your bags. You then deposit, sell and salvage in game as usual.
   - **Tidy the bank** sorts what stays into the suggested tabs.
5. **Hold F8 in the game.** It keeps going while you hold the key and stops the moment you let go; a tap does one step. It scrolls the bank when a step needs a tab that's off screen. If two tabs can't show together, it carries the item through an empty bag slot.
6. **Destroys** (optional, under Clear out) are never part of a held run. Each one needs its own press of F8: it drags the item out of your bags, F10 types its name if the game asks, and you click confirm yourself.

The macro stops, without moving anything, whenever:
- Guild Wars 2 isn't the window in front;
- a slot doesn't look like what the plan expects;
- a move doesn't land the way it should.

Between moves the pointer rests on open ground, so item tooltips don't get in the way. It never presses Enter or clicks confirm.

ArenaNet's [macro policy](https://help.guildwars2.com/hc/en-us/articles/360013762153) allows attended macros and auto-clickers that work through a stack of items. Holding the key keeps you in control the whole time, so stay at the keyboard while it runs.

## Running from source

```bash
npm install
```

```bash
npm run tauri dev
```

Tests:

```bash
npm test
```

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

`cargo test -- --include-ignored` also runs the tests that need the network and a screen.

To build an installer:

```bash
npm run tauri build
```

`npm run dev` serves just the interface at http://localhost:1420 for working on it in a browser. The macro, hotkeys and markers only work in the desktop app.

## How it's put together

- **`src/core/`** holds the logic, with no page code. It's tested with `node --test` against recorded API responses in `test/fixtures/`. Re-record them with `node scripts/record-fixtures.mjs`.
  - `account.js` loads everything from one key.
  - `bank.js` is the cleanup planner, and `recipes.js` does the "used to craft" check.
  - `finder.js` is the item search.
  - `timers.js` and `daily.js` handle the schedule and resets.
  - `stats.js` and `optimizer.js` handle gear stats, and `eilog.js` reads Elite Insights logs.
  - `arrange.js` plans the moves, `matcher.js` compares icons, and `calibration.js` works out where slots are on screen.
- **`src/ui/`** has one file per tab, plus `common.js`.
- **`src/platform.js`** is the only file that talks to Tauri. In a plain browser everything falls back to something safe.
- **`src-tauri/src/engine/`** is the native side: screen capture (`capture.rs`), item icon fingerprints (`icons.rs`, `fingerprint.rs`), mouse and keyboard input (`input.rs`) and the foreground window check (`window.rs`).

Gear stats use the API's own formula, `round(attribute_adjustment × multiplier + value)`. It was checked against in-game values. Damage scores are estimates, and the Builds tab says what they leave out.

## Credits

- **Event schedules** come from the [Guild Wars 2 Wiki](https://wiki.guildwars2.com/wiki/Event_timers) event timer data.
- **Item data, icons and prices** come from the official Guild Wars 2 API.
- **Not affiliated with ArenaNet.** Guild Wars 2 is a trademark of ArenaNet, LLC.
