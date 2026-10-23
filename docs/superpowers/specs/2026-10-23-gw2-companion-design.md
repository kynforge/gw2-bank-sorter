# GW2 Companion — design

Date: 2026-10-23
Status: approved to build ("go all in, build the whole thing out")

## Intent

A personal helper for Guild Wars 2 that floats over the game and makes everyday play easier. It is for one player, not for publishing. It grows out of the existing bank cleanup planner (`gw2-bank-sorter.html`), which stays as a standalone web page.

Online research (r/Guildwars2, official forums, 2024–2026) ranked these as the most common complaints an outside tool can fix:

1. "I don't know what this item is for, so I can't safely delete, sell or salvage it."
2. No in-game timers for world bosses and metas, and no "what haven't I done today" view.
3. Wizard's Vault progress and routing.
4. Picking builds and gearing characters is overwhelming.
5. Finding which character or bank tab holds an item, including currencies stranded as items on alts.
6. The bank can't sort itself.

## Goals

- One always-on-top window over the game, with a hotkey to show or hide it and another to make it click-through.
- **Bank**: the existing cleanup planner, plus "what is this for?" recipe checks and a high-value warning.
- **Find**: search every item on the account by name, and list items scattered across characters.
- **Today**: timers for world bosses and metas with waypoint codes, plus a "done today" checklist and Wizard's Vault progress.
- **Builds**: read a character's equipped gear, show its real stats, and suggest stat changes for a chosen goal, using exact numbers from the API. Elite Insights logs can optionally supply real boon uptimes.
- **Macro**: rearranges the bank one move per key press, checking item icons before and after each move. It can also set up a destroy, typing the item name on a separate key press, and stops for you to confirm.

## Non-goals

- Anything that plays the game, runs unattended, or does more than one in-game action per key press.
- The macro never clicks confirm, never presses Enter, and never sells, salvages or uses items.
- No code injected into the game process, and no reading game memory.
- No AI features in this version. AI plan review is a future tool.
- No publishing, accounts or servers. Everything stays on this PC.

## Anti-goals (failure even if it "works")

- An item gets destroyed or moved that the player didn't intend. Every step must fail safe: when unsure, stop.
- The tool crashes or slows the game.
- The tool shows numbers that look authoritative but are made up. Anything estimated is labelled as an estimate.

## Constraints

- Windows 11, with Node 24, Rust 1.91 and WebView2 available.
- Must run alongside ArcDPS, so it can't hook DirectX. The game has to be in windowed or windowed fullscreen mode for an overlay window to show.
- ArenaNet macro policy: attended use only, and "each macro should represent a single action that requires user input before repeating the action" (help.guildwars2.com article 360013762153).
- API data lags the game by a few minutes. Every feature says so where it matters.
- The API has no Mystic Forge recipes, so recipe checks note that gap.

## Decisions (builder's calls, stated to the user)

- **Stack**: Tauri 2 (Rust core + web front end), Vite, plain JavaScript ES modules with no framework, matching the existing code.
- **Layout**: a new `app/` folder. `app/src/core/` holds pure logic, tested with `node --test`. `app/src/ui/` holds the panels, and `app/src-tauri/` holds the native code.
- **Storage**: settings and the API key go in the webview's `localStorage`, as the existing page does. The key is sent only to `api.guildwars2.com`.
- **Timer data**: copied from the GW2 Wiki event timer widget (`Widget:Event timer/data.json`, v5.4, archived 2026-10-14) into `app/src/data/event-timers.json`, credited to the wiki. Each event's sequence starts at 00:00 UTC (the `partial` list, then `pattern` repeated).
- **Stat maths**: an item's attribute equals `round(attribute_adjustment × multiplier + value)`. This was verified against Twilight (251/179/179 Berserker) and Prismatic Champion's Regalia (157/108/108 using itemstat 584). Suggestions use each slot's legendary reference item, found through `/v2/legendaryarmory`, for both the stat choices and the adjustment, so they are ascended-equivalent numbers.
- **Combat formulas**:
  - Crit chance = 5% + (Precision − 1000)/21%, capped at 100%. Crit damage = 150% + Ferocity/15%.
  - Condition duration = Expertise/15%, and boon duration = Concentration/15%, both capped at 100%.
  - Might gives +30 Power and +30 Condition Damage per stack. Fury defaults to +25% crit chance (PvE).
  - The power score is Power × (1 + crit chance × (crit damage − 1)). The condition score is (base + coefficient × Condition Damage) × (1 + duration) for a chosen main condition.
  - All of these are labelled estimates, and their assumptions can be edited.

## Feature details

### Overlay shell
- A frameless, transparent, always-on-top window, 440×820 by default, that you can move and resize. It starts in interactive mode.
- Hotkeys (global, rebindable): Ctrl+Shift+G shows or hides the window, and Ctrl+Shift+C toggles click-through. When click-through is on, the window dims and all mouse input passes to the game.
- Tabs: Today · Bank · Find · Builds · Macro · Settings. An opacity slider sits in Settings.
- One shared account loader (key, permissions, bank, materials, shared slots, characters, unlocks, collections, done-today, Wizard's Vault). It loads on demand and has a Refresh button with a "read at" time.

### Bank (port of the existing planner)
- Same classification, plan, layout and per-account preferences, moved into modules with no global state, so it can be tested.
- New:
  - **Recipe check:** for destroy and vendor candidates, `/v2/recipes/search?input=ID`. If the item is an ingredient, destroy becomes keep ("Used to craft …"), and vendor rows get a note. The inspector shows "Used to craft" for any item when opened.
  - **High-value warning:** a threshold in Settings (default 10 gold) flags sell, salvage and vendor rows above it.
  - **Arrangement export** for the macro: the current bank stacks reordered into the same tab groups, without merging.

### Find
- A search box with case- and accent-insensitive substring and word-start matching across the bank, material storage, shared slots, every character's bags, equipped gear and the legendary armory.
- Results group by item, showing the total count, each location and its count, the Trading Post value and a copyable chat code.
- **Scattered items**: items that sit on three or more characters (excluding equipped gear), sorted by how spread out they are. This covers currencies stranded on alts.

### Today
- **Timers**: upcoming events in the next 2 hours, grouped Now / Soon / Later, with countdowns, and a copy button for the waypoint code (paste into game chat).
  - You can filter by category and star favourites.
  - Desktop alerts fire N minutes (default 5) before a starred event.
- **Done today**:
  - World bosses (`/v2/account/worldbosses`), meta chests (`/v2/account/mapchests`) and daily crafting (`/v2/account/dailycrafting`), each ticked or unticked.
  - Daily reset countdown (00:00 UTC) and weekly reset countdown (Monday 07:30 UTC).
- **Wizard's Vault**: daily, weekly and special objectives with progress, from `/v2/account/wizardsvault/{daily,weekly,special}`.

### Builds
- Pick a character. The tool loads the active equipment tab, falling back to `/equipment`.
- **Current stats**:
  - Sources: base 1000s, gear (from `stats.attributes` or the item's `infix_upgrade`), runes (6-piece count, parsing "+N Attribute" bonus lines), infusions and jewels.
  - Output: crit chance, crit damage, condition duration, boon duration and health.
- **Goals**:
  - Power DPS.
  - Condition DPS, choosing bleeding, burning, poison, torment or confusion.
  - Hybrid.
  - Boon DPS, which maximises power with a minimum boon duration.
  - Boon healer, which maximises Healing Power with a minimum boon duration.
- **Assumptions**: Might stacks, Fury uptime, extra crit chance, and flat stats from food and utility. Importing an Elite Insights JSON log fills in Might and Fury from the fight.
- **Optimizer**:
  - A beam search over equipped slots (6 armor pieces, active weapon set, back, amulet, 2 rings, 2 accessories). It chooses each slot's stat combination from goal-relevant candidates that the slot's legendary allows.
  - Shows a per-slot recommendation, only the slots that change, before and after derived stats, and the score change as a percentage.
- Scope note shown in the panel: traits, sigil procs and skill coefficients aren't modelled.

### Macro
- **Calibration** (the bank is open in game):
  - Hover over the centre of the first slot of a visible tab and press the calibration key (F7).
  - Hover over the last slot of that row, press F7, and enter the slots per row.
  - For every other visible tab, hover its first slot and press F7.
  - Calibration is saved per screen resolution. A destroy drop point is calibrated the same way.
- **Verify**: captures every calibrated slot and matches it against the expected item's icon. It shows a match grid and learns what an empty slot looks like from slots the API says are empty. Nothing moves in this mode.
- **Steps**:
  - Arrangement swaps built by a greedy permutation over item identity (id plus binding). It never drops onto the same item id, so no accidental merges.
  - Destroy setups for planned destroy items in calibrated slots.
- **Next step key (F8)**, one action per press:
  1. Check that Guild Wars 2 is the foreground window.
  2. Check that the source matches the expected icon and the destination matches its expected item or is empty.
  3. Drag (or drag to the drop point for a destroy).
  4. Re-capture and confirm the result.
  5. Update the model.
  6. Put the cursor back.
  - Any mismatch stops the run and explains why.
- **Type name key (F10)**: only within 20 seconds after a destroy step. It types the item's name as Unicode characters and never presses Enter. Item names come from the API in English, and the panel warns that the game client must use English names too.
- **Stop key (F9)**: aborts.
- The panel always shows the next step, what was checked, and the policy line.

### Settings
- API key (with "remember" and "forget"), hotkeys, opacity, high-value threshold, alert lead time and timer categories.

## Testing

- `node --test` for the core modules: bank classification on the example bank, timer expansion at known times, stat maths against the verified items, the optimizer on small cases, the move planner's swaps, and the finder.
- `cargo test` for icon matching (synthetic images) and calibration geometry.
- UI checked in the browser pane with the example data (native calls stubbed when not running in Tauri), then a real Tauri build launched and screenshotted.
- The input automation can't be tested against the real game here. Verify mode exists so the player can check calibration safely before any move.

## Left to the builder

Visual design within the existing palette, file split inside `core/` and `ui/`, candidate stat lists per goal, beam width, icon-match thresholds (tuned on synthetic tests and set conservatively), and exact wording.

## Future

AI plan review (Claude API), legendary goal tracker (needs Mystic Forge data the API lacks), Trading Post history, and a Nexus-addon version.
