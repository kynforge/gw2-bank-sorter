# GW2 Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri overlay app with Bank, Find, Today, Builds, Macro and Settings panels on top of the existing bank planner's logic.

**Architecture:** `app/src/core/` is pure JS with no DOM, unit-tested with `node --test` against recorded API fixtures. `app/src/ui/` renders one panel per file into the shell from `app/src/main.js`. `app/src/platform.js` is the only file that touches Tauri, and it has browser fallbacks so the UI runs in a plain browser. `app/src-tauri/` holds only what JS can't do: screen capture, icon decoding, mouse and keyboard input, and the foreground-window check.

**Tech Stack:** Tauri 2.x (`tauri = "2"`, `@tauri-apps/api@^2.12`), plugins global-shortcut and notification, Vite, plain ES modules, Rust crates `windows` 0.62, `ureq`, `image`.

**Spec:** `docs/superpowers/specs/2026-10-23-gw2-companion-design.md`

## Global Constraints

- API base `https://api.guildwars2.com/v2`. The key is sent nowhere else.
- Item stat = `Math.round(attribute_adjustment * multiplier + value)`.
- Crit chance = 5 + (Precision − 1000)/21 (%), capped at 100. Crit damage = 150 + Ferocity/15 (%). Condition and boon duration = attribute/15 (%), capped at 100.
- Might = +30 Power and +30 Condition Damage per stack. Fury default = +25% crit chance.
- Macro: one in-game action per key press. Never sends Enter, never clicks confirm. The type-name window lasts 20 s after a destroy step.
- Default hotkeys:
  - Ctrl+Shift+G show/hide, Ctrl+Shift+C click-through.
  - F7 calibrate, F8 next step, F9 stop, F10 type name. These are registered only while the macro is armed.
- Daily reset 00:00 UTC. Weekly reset Monday 07:30 UTC.
- Timer data credit: "Schedule data from the Guild Wars 2 Wiki event timer."
- Copy follows the existing app's voice: plain, short sentences, no jargon.

## Review Focus

1. **Expired or wrong API key mid-session** → a clear message in the status line. Panels keep the last good data. (Task 2: `account.test.js` "401 keeps previous data")
2. **Character with an empty equipment slot or no active equipment tab** → the optimizer skips empty slots and says which ones. (Task 6: `stats.test.js` "missing slots are reported")
3. **Bank scrolled after calibration** → the first icon check fails, and the step stops with "Bank looks different from the plan" instead of moving. (Task 7: `matcher.test.js` "rejects when expected is not best")
4. **Two stacks of the same item in the bank** → the move planner never drops one onto the other, so there's no merge. (Task 7: `arrange.test.js` "identical ids are interchangeable")
5. **Timer view across midnight UTC** → events after 00:00 come from the next day's sequence. (Task 5: `timers.test.js` "crosses midnight")

---

### Task 1: App scaffold and overlay shell

**Files:**
- Create: `app/package.json`, `app/vite.config.js`, `app/index.html`, `app/src/main.js`, `app/src/platform.js`, `app/src/styles.css`
- Create: `app/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/main.rs,src/lib.rs,icons/*}`
- Modify: `.gitignore` (add `app/node_modules`, `app/dist`, `app/src-tauri/target`, `app/src-tauri/gen`)

**Interfaces:**
- Produces, in `platform.js`:
  - `isDesktop: boolean` and `invoke(cmd, args)` (rejects in the browser).
  - `win.{toggleVisible(), setClickThrough(on), startDrag(), minimize(), close()}`.
  - `hotkeys.register(accel, fn)`, `hotkeys.unregister(accel)`. In the browser these fall back to `keydown`.
  - `notify(title, body)` and `copyText(text)`.
- Produces, in `main.js`:
  - `registerPanel({ id, title, mount(root, ctx), show?() })`.
  - `ctx = { getAccount(), onAccount(fn), setStatus(msg, isError), settings, saveSettings() }`.

- [ ] **Step 1:** Write `package.json` with scripts: `dev` (vite), `build` (vite build), `test` (`node --test test/`) and `tauri` (tauri). Dependencies: `@tauri-apps/api`, `@tauri-apps/plugin-global-shortcut`, `@tauri-apps/plugin-notification`. Dev dependencies: `@tauri-apps/cli`, `vite`.
- [ ] **Step 2:** Configure `tauri.conf.json`. The main window is 440×820 and frameless (`decorations:false`), with `transparent:true`, `alwaysOnTop:true` and `resizable:true`. The identifier is `com.kynforge.gw2companion`, and the dev URL is `http://localhost:1420`. The capability grants window show/hide/ignore-cursor-events/start-dragging/minimize/close/set-always-on-top, global-shortcut register/unregister, and notification default.
- [ ] **Step 3:** Build the shell. It has a drag-region title bar (title "GW2 Companion" plus minimize and close buttons), a tab bar, a status line and a panel area. The body background is transparent, and the panel background is `color-mix(in srgb, var(--panel) calc(var(--opacity)*100%), transparent)`. Port the palette and font tokens from `gw2-bank-sorter.html`.
- [ ] **Step 4:** Run `npm install`, then `npm run dev`. Open `http://localhost:1420` in the browser pane and check that the tabs switch.
- [ ] **Step 5:** Run `cargo check` in `app/src-tauri`. Expected: it finishes without errors.

### Task 2: Core port: API, formatting, example data, account loader

**Files:**
- Create: `app/src/core/api.js`, `app/src/core/format.js`, `app/src/core/example.js`, `app/src/core/account.js`
- Create: `app/test/fixtures/example-catalog.json` (recorded once with `app/scripts/record-fixtures.mjs`), `app/test/account.test.js`

**Interfaces:**
- Produces, in `api.js`:
  - `class UserError`.
  - `getJSON(path, params?, {auth?, fetchImpl?})` and `getMany(path, ids, {concurrency?, onProgress?, fetchImpl?})`.
  - `setFetch(fn)` swaps the transport for tests.
- Produces, in `format.js`: `esc`, `coinParts`, `coinHTML`, `coinText`, `plural`.
- Produces, in `account.js`:
  - `loadAccount(key, {onStatus}) → Promise<Account>` and `loadExample({onStatus}) → Promise<Account>`.
  - `buildContainers(bank, shared, characters)` and `whereText(c, cell)`.
- The `Account` shape:
  - `{source, name, loadedAt, key?, perms:Set, bank, containers, items:Map, prices:Map, storable:Map, storage:Map, capacity, inferred}`
  - `owned|null, unlocks, chars, needs|null, colls, characters:[{name, profession, equipment|null}]`
  - `legendary:Map<id,count>, done:{worldbosses,mapchests,dailycrafting}` (each a `Set|null`), `vault:{daily,weekly,special}|null`
  - `needsReady: Promise` (resolves when collections arrive)

- [ ] **Step 1:** Write the fixture recorder script and record the example's items, prices and materials into the fixture.
- [ ] **Step 2:** Write the failing tests:
  - `loadExample builds containers` asserts bank length 120, 3+ containers, and that `whereText` for bank index 31 is `"Tab 2, slot 2"`.
  - `401 keeps previous data` asserts that `loadAccount` rejects with `UserError` matching `/didn't accept this API key/`.
- [ ] **Step 3:** Run `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Port `getJSON`, `getMany`, the example, `buildContainers` and the loaders from `gw2-bank-sorter.html` (lines 439–500, 536–557, 592–626, 628–697, 699–840). Then add the extra optional loads: equipment via `/characters?ids=all`, the legendary armory, done-today, and the vault. Each degrades to `null`/`"missing"` without the matching permission, as the existing optional loads do.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.

### Task 3: Bank panel (port + recipe check + high-value flag + arrangement export)

**Files:**
- Create: `app/src/core/bank.js`, `app/src/core/recipes.js`, `app/src/ui/bank.js`
- Test: `app/test/bank.test.js`

**Interfaces:**
- Consumes: `Account` from Task 2.
- Produces, in `bank.js`:
  - `analyze(account, prefs, {recipeUses?:Map<id,string[]>}) → Result` (the existing `analyze` result shape).
  - `isUnlocked(item, owned)`, `categoryOf(item, storable)`, `compareEntries(a,b,storable)`, `isStackable(slot,item)`.
- Produces, in `recipes.js`: `recipeUses(itemIds, {fetchImpl?}) → Promise<Map<id, string[]>>`, which returns output item names and is cached per session.

- [ ] **Step 1:** Write the failing tests against the fixture:
  - `example plan classifies known items`:
    - the Abyss Dye (owned) becomes `sell` or `destroy`;
    - Glob of Ectoplasm ×87 at bank 2 becomes `deposit`;
    - the two Mithril Ore stacks at bank 63/64 get one `stack`;
    - the Luminescent laces needed by a collection become `keep`.
  - `destroy becomes keep when used in a recipe` uses `recipeUses` = `{id: ["Some Output"]}` and expects `action:"keep"` with a reason containing `"Some Output"`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Port the classification and layout (existing lines 869–1164), taking `account` and `prefs` as parameters instead of globals. Then add the recipe rule: destroy → keep when the item is used in a recipe, and vendor gets an alt note.
- [ ] **Step 4:** Port the rendering and events (existing lines 1166–1690) into `ui/bank.js`, scoped to its root:
  - Rows over `settings.highValue` (copper, default 100000) get a "High value" badge.
  - Opening the inspector calls `recipeUses([id])` and shows "Used to craft".
  - The prefs storage key stays `gw2-bank-sorter.prefs.<account>`, so existing ticks carry over.
- [ ] **Step 5:** Run `npm test`. Expected: PASS. Check the panel with the example bank in the browser pane.

### Task 4: Find panel

**Files:** Create `app/src/core/finder.js` and `app/src/ui/find.js`. Test: `app/test/finder.test.js`

**Interfaces:**
- Produces:
  - `buildIndex(account) → Index`. Every entry is `{item, total, places:[{where, count, kind}]}` and includes material storage, equipped gear and the legendary armory.
  - `search(index, query, limit=50) → Entry[]` and `scattered(index, minChars=3) → Entry[]`.

- [ ] **Step 1:** Write the failing tests:
  - `search is case and accent insensitive` ("ecto" finds Glob of Ectoplasm, with total = bank + bags + storage).
  - `word-start beats substring`.
  - `scattered lists items on 3+ characters` (a synthetic account).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Normalize with `normalize("NFD")` and strip combining marks. Ranking: exact > word-start > substring, then by total count.
- [ ] **Step 4:** Run the tests. Expected: PASS. Build the UI: a search box, result cards (icon, name, total, places, TP value, copy chat code), and a "Scattered across characters" section.

### Task 5: Today panel (timers, done today, Wizard's Vault, alerts)

**Files:**
- Create: `app/src/data/event-timers.json` (copied from the scratchpad download), `app/src/core/timers.js`, `app/src/core/daily.js`, `app/src/ui/today.js`
- Test: `app/test/timers.test.js`

**Interfaces:**
- Produces, in `timers.js`:
  - `occurrences(data, fromMs, toMs) → [{key, eventId, category, mapName, name, chatlink|null, start, end}]`. Filler segments without a name are skipped.
  - `WORLD_BOSS_API_IDS: {[scheduleName]: apiId}`.
- Produces, in `daily.js`: `nextDailyReset(nowMs)`, `nextWeeklyReset(nowMs)` and `formatCountdown(ms)`.

- [ ] **Step 1:** Write the failing tests:
  - `world bosses at known times`: on 2026-10-23, The Shatterer starts at 01:00 and 04:00 UTC, and Tequatl at 11:30 UTC.
  - `crosses midnight`: a 23:30–00:45 window includes Admiral Taidha Covington at 00:00 the next day.
  - `weekly reset is Monday 07:30 UTC`: from Thu 2026-10-23 12:00Z it lands on 2026-10-26T07:30Z.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the expansion. For each event, starting at 00:00 UTC of each day in range: walk `partial`, then repeat `pattern` until past 24h, emitting segments.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Build the UI:
  - Now / Soon / Later lists for the next 120 minutes, refreshed every 15 s.
  - Category filter chips, favourite stars and copy-waypoint buttons.
  - Done-today ticks (world bosses mapped through `WORLD_BOSS_API_IDS`, map chests, daily crafting).
  - Within each group, events not done today sort first, and done ones are dimmed. Map metas are matched to `/v2/account/mapchests` through `MAPCHEST_EVENT_IDS`, keyed on the timer event id.
  - Vault objectives with progress bars and reset countdowns.
  - Alerts through `notify` at `settings.alertLead` minutes (default 5) before favourites, firing once per occurrence key.

### Task 6: Builds panel (stats, optimizer, Elite Insights import)

**Files:**
- Create: `app/src/core/stats.js`, `app/src/core/optimizer.js`, `app/src/core/eilog.js`, `app/src/ui/builds.js`
- Test: `app/test/stats.test.js`, `app/test/optimizer.test.js`

**Interfaces:**
- Produces, in `stats.js`:
  - `itemStat(adj, itemstat) → {[attr]: number}`.
  - `gearAttributes(equipment, catalog) → {attrs, missing:string[], sources:[]}`. `catalog = {items:Map, itemstats:Map}`.
  - `derived(attrs, assumptions) → {critChance, critDamage, condDuration, boonDuration, power, condiDamage, healing, health}`.
  - `DEFAULT_ASSUMPTIONS = {might:25, fury:1, furyCrit:25, extraCrit:0, flat:{}}`.
- Produces, in `optimizer.js`:
  - `GOALS` (ids `power`, `condi`, `hybrid`, `boonDps`, `healer`).
  - `score(derived, goal, opts)`.
  - `optimize({slots:[{slot, adj, choices:itemstat[]}], base:attrs, goal, opts, assumptions, beam=2000}) → {picks:{slot:itemstatId}, attrs, derived, score}`.
- Produces, in `eilog.js`: `parseEliteInsights(json, characterName?) → {name, might, fury, players:string[]}`.

- [ ] **Step 1:** Write the failing tests:
  - `itemStat matches in-game`: adj 717.024 with itemstat 161 gives `{Power:251, Precision:179, CritDamage:179}`, and adj 358.512 with itemstat 584 gives `{Power:157, Precision:108, CritDamage:108}`.
  - `crit chance formula`: Precision 2000 gives 52.62 (±0.01), and Precision 4000 is capped at 100.
  - `missing slots are reported`: equipment without `Ring2` gives `missing` containing `"Ring2"`.
  - `optimizer prefers precision when under the cap`: a toy 2-slot case where Assassin beats Berserker at low precision, and Berserker wins once crit is capped.
  - `boonDps respects minimum boon duration`.
  - `parseEliteInsights reads might and fury`: a synthetic log with buff 740 uptime 22.5 and buff 725 uptime 87.0 gives might 22.5 and fury 0.87.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - Runes: count runes across armor pieces and apply the first N lines of `details.bonuses` that match `/^\+(\d+)%? (.+)$/`. Map stat names "Power", "Precision", "Toughness", "Vitality", "Ferocity", "Condition Damage", "Expertise", "Concentration" and "Healing Power" to API keys. Map "% Condition Duration" and "% Boon Duration" to duration bonuses.
  - Beam search: process slots in descending `adj` order. States are deduped by their rounded attribute vector. Partial states are scored by `score(derived(attrs + optimistic remainder))`, and unmet constraints carry a penalty of 1e6 per missing %.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Build the UI:
  - A character picker, current stats, and a goal picker with its options.
  - An assumptions form and Elite Insights file input.
  - A results table of slot / now / suggested, with changed slots highlighted, plus a scope note.
  - Each changed slot says "Free: legendary, swap stats" when the equipped item is legendary, and "Needs new gear" otherwise.
  - Reference legendary items come from `/v2/legendaryarmory`, and itemstats from `/v2/itemstats?ids=all`. Both are cached in `localStorage` per game build id.

### Task 7: Move planner and icon matcher (JS core)

**Files:** Create `app/src/core/arrange.js` and `app/src/core/matcher.js`. Test: `app/test/arrange.test.js` and `app/test/matcher.test.js`

**Interfaces:**
- Produces, in `arrange.js`:
  - `planArrangement(bankSlots, items, storable, tabCount) → target:(Signature|null)[]`. The signature is `"id|binding"`. It applies the Task 3 category order without merging stacks.
  - `planMoves(current:(Signature|null)[], target) → [{from, to}]`. Applying each step as a swap turns `current` into `target`.
  - `applyMove(arr, move)`.
- Produces, in `matcher.js`:
  - `similarity(fpA, fpB) → 0..1`, the mean of the Pearson correlation (mapped to 0..1) and `1 − meanAbsDiff/255`.
  - `judge(fp, expectedFp|'empty', candidates:{key, fp}[], emptyFp|null, {threshold=0.8, margin=0.05}) → {ok, score, best, reason}`.
  - Fingerprints are `Uint8Array(192)`: 8×8 RGB of the slot's central 50%.

- [ ] **Step 1:** Write the failing tests:
  - `planMoves reaches target`: random permutations with empties; after applying, the result equals the target, with move count ≤ the number of misplaced slots.
  - `identical ids are interchangeable`: two stacks of `"19721|"` in swapped positions produce 0 moves.
  - `never drops onto same id` (property check over every planned step).
  - `judge accepts the expected icon with noise`.
  - `rejects when expected is not best`.
  - `empty slot detection`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `planMoves` greedily. For each position p in order where `current[p] !== target[p]`, find q > p whose `current[q] === target[p]`, preferring a q whose own target equals `current[p]` (a one-move fix of both). Emit `{from:q, to:p}` and swap.
- [ ] **Step 4:** Run the tests. Expected: PASS.

### Task 8: Native macro engine (Rust)

**Files:**
- Create: `app/src-tauri/src/engine/{mod.rs, fingerprint.rs, capture.rs, input.rs, window.rs, icons.rs}`
- Modify: `app/src-tauri/src/lib.rs` (register the commands), `app/src-tauri/Cargo.toml` (the `windows` features `Win32_Foundation`, `Win32_Graphics_Gdi`, `Win32_UI_WindowsAndMessaging`, `Win32_UI_Input_KeyboardAndMouse`; `ureq`; `image` with `png`)

**Interfaces:** Tauri commands, all callable through `invoke`:
- `cursor_pos() → [i32;2]` and `gw2_foreground() → bool` (foreground window title is "Guild Wars 2").
- `screen_fingerprints(rects: Vec<[i32;3]>) → Vec<Vec<u8>>`, where each rect is x, y, size in physical pixels, centred on the slot.
- `icon_fingerprints(urls: Vec<String>) → Vec<Option<Vec<u8>>>`, cached in memory.
- `drag(from: [i32;2], to: [i32;2]) → ()`: absolute `SendInput`, 12 interpolated moves at 12 ms, with 60 ms holds, then the cursor is restored.
- `type_text(text: String) → ()`: `KEYEVENTF_UNICODE` down/up per UTF-16 unit, 15 ms apart. It refuses any text containing `\r` or `\n`.

- [ ] **Step 1:** Write the failing `cargo test` tests in `fingerprint.rs`:
  - `fingerprint_of_solid_color` (all 192 values equal the colour).
  - `central_crop_ignores_corners` (corner noise doesn't change the result).
  - `scaled_icon_matches_original` (64→40 px resample, mean abs diff < 12).
- [ ] **Step 2:** Run `cargo test`. Expected: FAIL.
- [ ] **Step 3:** Implement `fingerprint(rgba:&[u8], w, h) → Vec<u8>`, which area-averages the central 50% into 8×8 RGB. Capture uses GDI `BitBlt` from the screen DC, `GetDIBits` into BGRA, then converts. Icons are fetched with `ureq` and decoded with `image`.
- [ ] **Step 4:** Run `cargo test`. Expected: PASS. Run `cargo build`. Expected: it finishes without errors.

### Task 9: Macro panel

**Files:** Create `app/src/ui/macro.js`.

**Interfaces:**
- Consumes: Task 3 `analyze`, Task 7 `planArrangement`/`planMoves`/`judge`, Task 8 commands.
- Produces: localStorage `gw2c.calibration.<width>x<height>`, holding `{pitch, cols, tabs:{[tab]:[x,y]}, drop:[x,y]|null, emptyFp:number[]|null}`.

- [ ] **Step 1:** Build an Arm/Disarm toggle. Arming registers F7–F10 through `platform.hotkeys`, and disarming (or closing the panel) unregisters them.
- [ ] **Step 2:** Build the calibration wizard, which uses F7 and `cursor_pos`:
  - first slot centre, then last slot of the row, plus a columns input → `pitch = (x2 − x1)/(cols − 1)`;
  - then the first slot of each other visible tab, and the optional destroy drop point.
- [ ] **Step 3:** Build Verify:
  - Fingerprint every calibrated slot and every expected icon, then render a match grid (✓ / ✗ / ?).
  - Learn `emptyFp` from the average of slots the API reports empty.
- [ ] **Step 4:** Build the step runner. Steps are the arrangement moves followed by destroy setups for planned destroy items in calibrated tabs.
  - F8 runs the next step. Gate checks: GW2 in the foreground, then a source and destination `judge`.
  - Then `drag`, re-fingerprint, `judge` the result, `applyMove` to the model, and show what happened.
  - Any failure stops the run and shows the reason.
  - F10 types the destroy item's name within 20 s of a destroy step. F9 stops.
- [ ] **Step 5:** Build "Show on screen". A second window `marker` (fullscreen, transparent, always on top, click-through) draws a ring over a calibrated slot, through `platform.markers.show(x, y, size, label)` and `hide()`.
  - Bank plan rows get a "Show in game" button when the slot's tab is calibrated.
  - The step runner highlights the next step's source and destination.
- [ ] **Step 6:** Check in the browser pane that the panel renders, and that it shows "Only in the desktop app" for native-only actions.

### Task 10: Settings, global hotkeys, desktop build, docs

**Files:** Create `app/src/ui/settings.js`. Modify `app/src/main.js`, `README.md`, and add `app/README.md`.

- [ ] **Step 1:** Build the Settings panel: API key (remember/forget), opacity slider, high-value threshold, alert lead and hotkey fields. Saving re-registers the hotkeys.
- [ ] **Step 2:** In `main.js`, register Ctrl+Shift+G (toggle visible) and Ctrl+Shift+C (click-through; the window dims and the title bar shows "Click-through on").
- [ ] **Step 3:** Run `npm test` and `cargo test`. Expected: all pass.
- [ ] **Step 4:** Run `npm run tauri build -- --debug`, launch the exe, take a screenshot, and check that the overlay draws on top.
- [ ] **Step 5:** Docs: how to run, the hotkeys, the policy notes and the windowed-fullscreen requirement.
