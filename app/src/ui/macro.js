// The Macro panel. Start, then one key press on the bank (and one on the bags) finds every slot by
// its icon. Then hold the step key: it clears out what the cleanup plan sells into the bags, or
// tidies the bank into the suggested tabs, scrolling as it goes. Every move is checked on screen
// before and after; it never confirms anything. The step rules live in core/runner.js (tested).
import { esc, plural } from "../core/format.js";
import { TAB_SIZE } from "../core/account.js";
import { analyze } from "../core/bank.js";
import { recipeUses } from "../core/recipes.js";
import { planArrangement, planMoves, applyMove, signature, unplacedCount } from "../core/arrange.js";
import { planClearOut } from "../core/clearout.js";
import { judge } from "../core/matcher.js";
import { createRunner } from "../core/runner.js";
import { registerAll } from "../core/keys.js";
import { findGrid, findInventory, relocate } from "../core/findgrid.js";
import { pitchFrom, calibrationKey, loadCalibration, saveCalibration, emptyCalibration } from "../core/calibration.js";
import { loadBankPrefs } from "./bank.js";
import { isDesktop, invoke, hotkeys, markers } from "../platform.js";

const FP = 192;
let root, ctx, $;
const calKey = () => calibrationKey(screen.width * devicePixelRatio, screen.height * devicePixelRatio);
let calib = loadCalibration(calKey());
let registered = [];          // hotkeys held, released as one
let finding = null;           // "bank" | "inv" while waiting for the find key
let manual = null;            // hand-marking: { what, tab? }
let firstPoint = null;
let mode = "clear";           // "clear": bank items the plan deals with go to the bags; "tidy": sort the bank
let withDestroys = false;
let plan = null;              // { mode, pending, unplaced, left } once planned
let iconFps = new Map();
let blocked = "", busy = false, lastAccount = null;
let stepHeld = false, lastPressAt = 0;   // ignore the step key's auto-repeat after a run ends
const log = [];

const armed = () => registered.length > 0;
const keyName = k => ctx.settings.hotkeys[k];
const account = () => ctx.getAccount();
const bankSize = () => account()?.bank.length || 0;
const tabCount = () => Math.ceil(bankSize() / TAB_SIZE);
const itemIdOf = sig => sig ? +sig.split("|")[0] : null;
const nameOf = sig => sig ? (account()?.items.get(itemIdOf(sig))?.name || `item ${itemIdOf(sig)}`) : "an empty slot";

/* ---------- Where things are ---------- */

// Bag slots come after the bank's, so one list of slots covers both windows.
function invContainer() {
  return calib.inv ? account()?.containers.find(c => c.id === `char:${calib.inv.character}`) : null;
}
function startModel() {
  const bank = account().bank.map(signature);
  const inv = invContainer()?.cells.map(c => signature(c.slot)) || [];
  return [...bank, ...inv];
}

function position(i) {
  const B = bankSize();
  if (i < B) {
    const o = calib.tabs[Math.floor(i / TAB_SIZE) + 1];
    if (!o) return null;
    const p = i % TAB_SIZE;
    return [Math.round(o[0] + (p % calib.cols) * calib.pitch), Math.round(o[1] + Math.floor(p / calib.cols) * calib.pitch)];
  }
  const inv = calib.inv;
  if (!inv) return null;
  const j = i - B;
  const s = inv.sections.find(sec => j >= sec.start && j < sec.start + sec.size);
  const o = s && inv.origins[s.id];
  if (!o) return null;
  const k = j - s.start;
  return [Math.round(o[0] + (k % inv.cols) * inv.pitch), Math.round(o[1] + Math.floor(k / inv.cols) * inv.pitch)];
}
const sizeAt = i => Math.round((i < bankSize() ? calib.pitch : calib.inv.pitch) * 0.88);

// Reads many slots in one screen capture. Markers are hidden first: they'd spoil the match.
async function sampleScreen(rects) {
  if (!rects.length) return [];
  await markers.hide();
  const out = [];
  for (let at = 0; at < rects.length; at += 20000) {
    const part = rects.slice(at, at + 20000);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [cx, cy, s] of part) { x0 = Math.min(x0, cx - s); y0 = Math.min(y0, cy - s); x1 = Math.max(x1, cx + s); y1 = Math.max(y1, cy + s); }
    const region = [Math.round(x0), Math.round(y0), Math.min(8192, Math.round(x1 - x0)), Math.min(8192, Math.round(y1 - y0))];
    const buf = new Uint8Array(await invoke("region_fingerprints", { region, rects: part.map(r => r.map(Math.round)) }));
    for (let k = 0; k < part.length; k++) out.push(buf.subarray(k * FP, (k + 1) * FP));
  }
  return out;
}

async function loadIcons(ids) {
  const items = account().items;
  const todo = [...new Set(ids)].filter(id => id && !iconFps.has(id) && items.get(id)?.icon);
  if (!todo.length) return;
  say(`Getting ${plural(todo.length, "item icon")}…`);
  const fps = await invoke("icon_fingerprints", { urls: todo.map(id => items.get(id).icon) });
  todo.forEach((id, k) => { if (fps[k]) iconFps.set(id, Uint8Array.from(fps[k])); });
}

function expectation(sig) {
  if (!sig) return "empty";
  return { key: nameOf(sig), fp: iconFps.get(itemIdOf(sig)) };
}
const candidatesFor = model => [...new Set(model.filter(Boolean).map(itemIdOf))]
  .filter(id => iconFps.has(id)).map(id => ({ key: account().items.get(id)?.name || `item ${id}`, fp: iconFps.get(id) }));

/* ---------- Finding the bank and bags ---------- */

async function onFindKey() {
  if (manual) return onManualKey();
  if (!finding) { say(`Press Start in the Macro tab first, then ${keyName("calibrate")}.`); return; }
  let origin, game;
  try {
    origin = await invoke("cursor_pos");
    game = await invoke("game_rect");
    if (!game) { say("Guild Wars 2 isn't the window in front. Click into the game and try again.", "bad"); return; }
    // Move the pointer off the slots so no tooltip covers them while the screen is read.
    await invoke("park_pointer", { to: [Math.round((game[0] + game[2]) / 2), game[1] + 12] });
  } catch (err) { say(String(err.message || err), "bad"); return; }

  if (finding === "bank") {
    say("Looking for your bank…");
    await loadIcons(account().bank.map(s => s?.id));
    const model = account().bank.map(signature);
    const g = await findGrid({ origin, sample: sampleScreen, expected: i => (model[i] ? expectation(model[i]) : "empty"), tabCount: tabCount(), bottom: game[3] });
    if (!g.ok) { say(g.reason, "bad"); return; }
    const found = Object.keys(g.tabs).map(Number).sort((a, b) => a - b);
    const rows = Math.ceil(TAB_SIZE / g.cols);
    const first = found[0], last = found[found.length - 1];
    calib = {
      ...emptyCalibration(), cols: g.cols, pitch: g.pitch, tabs: g.tabs, emptyFp: g.emptyFp, offset: 0, tickPx: null,
      x0: g.tabs[first][0], restManual: calib.restManual, drop: calib.restManual ? calib.drop : null,
      anchor: { id: first, y: g.tabs[first][1] },
      stride: found.length > 1 ? (g.tabs[found[1]][1] - g.tabs[first][1]) / (found[1] - first) : null,
      viewport: [g.tabs[first][1] - g.pitch * 0.6, g.tabs[last][1] + (rows - 1) * g.pitch + g.pitch * 0.6],
    };
    calib.drop = restSpot(game);
    saveCalibration(calKey(), calib);
    say(`Found bank ${found.length > 1 ? `tabs ${first}–${last}` : `tab ${first}`}, ${g.cols} slots per row. ${g.matched} of ${g.checked} slots match.`, g.matched / Math.max(1, g.checked) > 0.9 ? "ok" : "");
    if (!calib.stride) say("Only one tab fits on screen, so the macro can't scroll. Make the bank window taller to show two tabs, and press Start again.", "warn");
    finding = "inv";
    plan = null;
    say(`Now hover the middle of the first slot of your inventory and press ${keyName("calibrate")}. Or press "Skip" to work in the bank only.`);
    render();
    return;
  }

  say("Looking for your bags…");
  const layouts = account().containers.filter(c => c.kind === "character")
    .map(c => ({ name: c.name, cells: c.cells.map(x => x.slot), sections: c.bags.map(b => ({ id: b.n, start: b.start, size: b.len })) }));
  await loadIcons(layouts.flatMap(l => l.cells.map(s => s?.id)));
  const inv = await findInventory({ origin, sample: sampleScreen, layouts, iconFp: id => iconFps.get(id), bottom: game[3] });
  if (!inv.ok) { say(inv.reason, "bad"); return; }
  calib.inv = { character: inv.character, pitch: inv.pitch, cols: inv.cols, origins: inv.origins, sections: inv.sections, emptyFp: inv.emptyFp };
  calib.drop = restSpot(game);
  saveCalibration(calKey(), calib);
  finding = null;
  plan = null;
  say(`Found ${inv.character}'s bags, ${inv.cols} slots per row. ${inv.matched} of ${inv.checked} slots match.`, "ok");
  render();
}

// Where the pointer rests between moves (and destroyed items are dropped): open ground in the
// game window, on the side away from the bank and bags, and not over this overlay.
function restSpot(game) {
  if (calib.restManual) return calib.drop;
  const [l, t, r, b] = game;
  const boxes = [];
  const box = (o, cols, pitch, rows) => [o[0] - pitch, o[1] - pitch, o[0] + cols * pitch, o[1] + rows * pitch];
  for (const o of Object.values(calib.tabs || {})) boxes.push(box(o, calib.cols, calib.pitch, Math.ceil(TAB_SIZE / calib.cols)));
  for (const o of Object.values(calib.inv?.origins || {})) boxes.push(box(o, calib.inv.cols, calib.inv.pitch, 4));
  const overlay = [window.screenX * devicePixelRatio, window.screenY * devicePixelRatio, (window.screenX + window.outerWidth) * devicePixelRatio, (window.screenY + window.outerHeight) * devicePixelRatio];
  const inside = ([x, y], [x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const dist = ([x, y], [x0, y0, x1, y1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  const candidates = [[0.25, 0.45], [0.75, 0.45], [0.5, 0.3], [0.5, 0.7], [0.35, 0.6], [0.65, 0.6]]
    .map(([fx, fy]) => [Math.round(l + (r - l) * fx), Math.round(t + (b - t) * fy)])
    .filter(p => !inside(p, overlay) && !boxes.some(bx => inside(p, bx)));
  if (!candidates.length) return calib.drop;
  return candidates.sort((p, q) => Math.min(...boxes.map(bx => dist(q, bx)), 1e9) - Math.min(...boxes.map(bx => dist(p, bx)), 1e9))[0];
}

/* ---------- Scrolling ---------- */

async function ensureVisible(need) {
  const B = bankSize();
  if (need.some(i => i >= B) && !calib.inv) return { ok: false, reason: `Find your bags first: press Start, then ${keyName("calibrate")} on the bank and again on your inventory.` };
  const tabs = [...new Set(need.filter(i => i < B).map(i => Math.floor(i / TAB_SIZE) + 1))];
  if (tabs.every(t => calib.tabs[t])) return { ok: true };
  if (!calib.stride) return { ok: false, reason: "That tab isn't on screen, and the macro can't scroll with only one tab showing. Make the bank window taller, then press Start again." };
  const P = calib.pitch, rows = Math.ceil(TAB_SIZE / calib.cols);
  const [top, bottom] = calib.viewport;
  const yOf = t => calib.anchor.y + (t - calib.anchor.id) * calib.stride + calib.offset;
  const lo = Math.min(...tabs), hi = Math.max(...tabs);
  if ((hi - lo) * calib.stride + rows * P > bottom - top) return { ok: false, reason: "Those tabs can't be on screen together." };
  const at = [Math.round(calib.x0 + ((calib.cols - 1) * P) / 2), Math.round((top + bottom) / 2)];   // the middle of the bank window
  for (let tries = 0; tries < 6; tries++) {
    const up = top + P / 2 - yOf(lo), down = yOf(hi) + (rows - 1) * P + P / 2 - bottom;
    const delta = up > 0 ? up : down > 0 ? -down : 0;
    if (!delta) break;
    const px = calib.tickPx;
    const ticks = px ? Math.max(-10, Math.min(10, Math.round(delta / px) || Math.sign(delta * px))) : Math.sign(delta);
    await invoke("scroll", { at, ticks, park: calib.drop });
    const predicted = calib.offset + (px ? ticks * px : 0);
    const range = px ? [predicted - Math.abs(px), predicted + Math.abs(px)] : [calib.offset - 3 * calib.stride, calib.offset + 3 * calib.stride];
    const model = runner.state.model;
    const res = await relocate({
      sample: sampleScreen, expected: i => (model[i] ? expectation(model[i]) : "empty"), tabCount: tabCount(),
      layout: { x0: calib.x0, pitch: P, cols: calib.cols, stride: calib.stride, anchor: calib.anchor },
      viewport: calib.viewport, range,
    });
    if (!res.ok) return { ok: false, reason: res.reason };
    if (res.offset === calib.offset) return { ok: false, reason: "The bank didn't scroll. Keep the bank window open where you found it, then try again." };
    if (!px) calib.tickPx = (res.offset - calib.offset) / ticks;
    calib.offset = res.offset;
    calib.tabs = res.origins;
    say(`Scrolled the bank to show ${Object.keys(res.origins).map(t => `tab ${t}`).join(", ")}.`);
    if (tabs.every(t => calib.tabs[t])) return { ok: true };
  }
  return tabs.every(t => calib.tabs[t]) ? { ok: true } : { ok: false, reason: "Couldn't scroll the bank to that tab." };
}

/* ---------- The runner's view of the game ---------- */

const runner = createRunner({
  foreground: () => invoke("gw2_foreground"),
  position,
  rest: () => calib.drop,
  park: to => invoke("park_pointer", { to }),
  hideMarkers: () => markers.hide(),
  showMarkers: step => showStepMarkers(step),
  capture: indexes => sampleScreen(indexes.map(i => [...position(i), sizeAt(i)])),
  judge: (fp, sig, phase, index) => {
    const exp = expectation(sig);
    if (exp !== "empty" && !exp.fp) return { ok: false, reason: `There's no icon to compare ${exp.key} with.` };
    const emptyFp = index >= bankSize() ? calib.inv?.emptyFp : calib.emptyFp;
    return judge(fp, exp, candidatesFor(runner.state.model), emptyFp);
  },
  drag: (from, to, park) => invoke("drag", { from, to, park }),
  wait: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
  typeText: text => invoke("type_text", { text }),
  itemName: nameOf,
  ensureVisible,
  spareSlot: model => calib.inv ? model.findIndex((sig, i) => i >= bankSize() && !sig) : -1,
}, { keys: () => ctx.settings.hotkeys });

/* ---------- Planning ---------- */

async function planSteps() {
  const a = account();
  const prefs = loadBankPrefs(a);
  let result = analyze(a, prefs);
  const destroyIds = [...new Set(result.slots.filter(s => s.action === "destroy").map(s => s.slot.id))];
  if (destroyIds.length) {
    const uses = await recipeUses(destroyIds).catch(() => null);
    result = analyze(a, prefs, { recipeUses: uses });
  }
  const model = startModel();
  const B = bankSize();
  if (mode === "clear") {
    if (!calib.inv) { say(`Clearing out needs your bags. Press Start, then ${keyName("calibrate")} on the bank and on your inventory.`, "bad"); return false; }
    const { steps, left } = planClearOut({ result, bankModel: model.slice(0, B), invModel: model.slice(B), invBase: B, withDestroys: withDestroys && !!calib.drop });
    runner.load(steps, model);
    plan = { mode, left, pending: 0, unplaced: 0 };
    say(`Planned ${plural(steps.filter(s => s.kind === "move").length, "item")} to take out${steps.some(s => s.kind === "destroy") ? `, then ${plural(steps.filter(s => s.kind === "destroy").length, "destroy")}` : ""}.${left ? ` ${left} more will wait until your bags have room.` : ""}`);
  } else {
    const bank = a.bank;
    const start = bank.map(signature);
    const target = planArrangement(bank, a.items, a.storable);
    const moves = planMoves(start, target).map(m => ({ kind: "move", ...m }));
    const sim = [...start];
    for (const m of moves) { m.item = a.items.get(itemIdOf(sim[m.from])); applyMove(sim, m); }
    runner.load(moves, model);
    plan = {
      mode, left: 0,
      pending: result.slots.filter(s => s.kind === "bank" && !["keep", "empty", "stack"].includes(s.action)).length,
      unplaced: unplacedCount(start, target, moves),
    };
    say(`Planned ${plural(moves.length, "move")}.`);
  }
  blocked = "";
  showStepMarkers(runner.state.steps[0]);
  refreshRun();
  return true;
}

function showStepMarkers(step) {
  if (!step || !calib.pitch) { markers.hide(); return; }
  const from = position(step.from);
  const to = step.kind === "destroy" ? calib.drop : position(step.to);
  const size = Math.round(step.from < bankSize() ? calib.pitch : calib.inv?.pitch || calib.pitch);
  const rings = [];
  if (from) rings.push({ x: from[0], y: from[1], size, label: step.kind === "destroy" ? "Destroy this" : "From" });
  if (to) rings.push({ x: to[0], y: to[1], size, label: step.kind === "destroy" ? "Drop" : "To", tone: step.kind === "destroy" ? "warn" : "to" });
  markers.show(rings);
}

/* ---------- Running ---------- */

const stepKeyDown = () => invoke("key_down", { key: keyName("step") }).catch(() => false);

async function onStepPress() {
  const now = Date.now();
  // After a run stops with the key still down, the key's auto-repeat must not start a new one.
  if (stepHeld && now - lastPressAt < 600) { lastPressAt = now; return; }
  lastPressAt = now;
  if (busy) return;
  busy = true;
  stepHeld = true;
  try {
    if (!account()) return;
    if (!calib.pitch) { say(`Find your bank first: press Start, then ${keyName("calibrate")}.`, "bad"); return; }
    if (!plan && !(await planSteps())) return;
    await loadIcons(runner.state.model.filter(Boolean).map(itemIdOf));
    const res = await runner.runWhileHeld({ stillHeld: stepKeyDown, onStep: r => { if (r.ok) say(r.message, r.tone || ""); } });
    blocked = res.ok ? "" : res.message;
    if (!res.ok || res.done || res.steps === 0 || /destroy|let go/i.test(res.message)) say(res.message, res.tone || (res.ok ? "" : "bad"));
    if (res.replan) plan = null;   // the bank no longer matches the plan; plan again from fresh data
    refreshRun();
  } catch (err) {
    blocked = `Something went wrong: ${err.message || err}. Nothing more will move until you press ${keyName("step")} again.`;
    say(blocked, "bad");
    refreshRun();
  } finally {
    busy = false;
    stepHeld = await stepKeyDown();
  }
}
function onStepRelease() { stepHeld = false; }

async function onTypeKey() {
  try {
    const res = await runner.typeName();
    say(res.message, res.tone || "");
  } catch (err) {
    say(`Couldn't type the name: ${err.message || err}`, "bad");
  }
}

async function onStopKey() {
  blocked = "Stopped with the stop key. Press Start to carry on.";
  say("Stopped.");
  await disarm();
}

/* ---------- Keys ---------- */

async function arm() {
  const k = ctx.settings.hotkeys;
  try {
    registered = await registerAll([
      [k.calibrate, onFindKey], [k.step, onStepPress, onStepRelease], [k.stop, onStopKey], [k.typeName, onTypeKey],
    ], hotkeys);
    return true;
  } catch (err) {
    registered = [];
    say(`Couldn't use the macro keys: ${err.message || err}. Another program may be using one of them; pick different keys in Settings.`, "bad");
    return false;
  }
}

async function disarm() {
  const held = registered;
  registered = [];
  for (const accel of held) await hotkeys.unregister(accel);
  finding = null;
  manual = null;
  markers.hide();
  if (held.length && root && !root.hidden) render();
}

/* ---------- Marking by hand (when finding doesn't work) ---------- */

async function onManualKey() {
  let pos;
  try { pos = await invoke("cursor_pos"); } catch (err) { say(String(err.message || err), "bad"); return; }
  if (manual.what === "first") { firstPoint = pos; manual = { what: "rowEnd" }; say("First slot marked. Now the last slot in that row."); }
  else if (manual.what === "rowEnd") {
    try {
      calib = { ...emptyCalibration(), cols: calib.cols || 10, pitch: pitchFrom(firstPoint, pos, calib.cols || 10), tabs: { 1: firstPoint }, x0: firstPoint[0], drop: calib.drop, restManual: calib.restManual };
      say(`Tab 1 marked. Slots are ${calib.pitch.toFixed(1)} px apart.`, "ok");
      manual = null;
    } catch (err) { manual = { what: "first" }; say(err.message, "bad"); }
  } else if (manual.what === "tab") { calib.tabs[manual.tab] = pos; say(`Tab ${manual.tab} marked.`, "ok"); manual = null; }
  else if (manual.what === "rest") { calib.drop = pos; calib.restManual = true; say("Resting spot marked.", "ok"); manual = null; }
  saveCalibration(calKey(), calib);
  plan = null;
  render();
}

/* ---------- Rendering ---------- */

function say(msg, tone = "") {
  log.unshift({ msg, tone, at: new Date() });
  log.length = Math.min(log.length, 10);
  renderLog();
}

function setupHTML() {
  const tabs = Object.keys(calib.tabs || {}).map(Number).sort((a, b) => a - b);
  const status = [
    calib.pitch ? `<li>Bank: ${tabs.length ? (tabs.length > 1 ? `tabs ${tabs[0]}–${tabs[tabs.length - 1]}` : `tab ${tabs[0]}`) : "no tabs"} on screen, ${calib.cols} slots per row${calib.stride ? ", can scroll" : ""}.</li>` : "",
    calib.inv ? `<li>Bags: ${esc(calib.inv.character)}, ${calib.inv.cols} slots per row.</li>` : "",
  ].join("");
  const prompt = finding === "bank" ? `Hover over the middle of the <b>first slot of the top bank tab</b> you can see and press <kbd>${esc(keyName("calibrate"))}</kbd>.`
    : finding === "inv" ? `Hover over the middle of the <b>first slot of your inventory</b> and press <kbd>${esc(keyName("calibrate"))}</kbd>. <button type="button" class="linkish" id="mcSkipInv">Skip, bank only</button>`
    : manual ? `Hand-marking: hover the ${manual.what === "rest" ? "spot" : "slot"} and press <kbd>${esc(keyName("calibrate"))}</kbd>.` : "";
  return `
    <section class="card">
      <h3>1. Find your bank and bags</h3>
      <p class="muted">Open your bank and your inventory in game, then press Start. One key press on each and the app finds every slot by its icon.</p>
      <div class="row"><button type="button" class="btn${armed() ? " ghost" : ""}" id="mcStart">${armed() ? "Stop" : "Start"}</button>
        ${armed() ? `<span class="badge ok">Keys on</span>` : ""}</div>
      ${prompt ? `<p class="notice">${prompt}</p>` : ""}
      ${status ? `<ul class="found">${status}</ul>` : ""}
      <details class="handmark"><summary>Mark by hand instead</summary>
        <p class="muted">If finding doesn't work, mark tab 1 yourself (Start first so the keys are on).</p>
        <ol class="steps-list">
          <li>Slots per row <input type="number" id="mcCols" class="input narrow" min="2" max="30" value="${calib.cols || 10}"></li>
          <li><button type="button" class="btn ghost small" data-mark="first">Mark tab 1</button> first slot, then the last slot in that row.</li>
          <li>Other tabs: <span class="filters">${Array.from({ length: Math.max(0, tabCount() - 1) }, (_, k) => k + 2).map(t => `<button type="button" class="chip all" data-mark="tab" data-tab="${t}" aria-pressed="${!!calib.tabs?.[t]}">Tab ${t}</button>`).join("")}</span></li>
          <li><button type="button" class="btn ghost small" data-mark="rest">Pick the resting spot</button> on open ground (the app picks one for you otherwise).</li>
        </ol>
      </details>
    </section>`;
}

function stepText(step) {
  const B = bankSize();
  const where = i => i < B ? `tab ${Math.floor(i / TAB_SIZE) + 1} slot ${(i % TAB_SIZE) + 1}` : "your bags";
  const name = step.item?.name || nameOf(runner.state.model[step.from]);
  if (step.kind === "destroy") return `Destroy ${name} (you confirm)`;
  if (step.to >= B && step.from < B) return `Take ${name} out of ${where(step.from)}`;
  return `Move ${name} from ${where(step.from)} to ${where(step.to)}`;
}

function runHTML() {
  if (!account()) return `<p class="muted">Loading…</p>`;
  const choice = `
    <div class="seg" role="group" aria-label="What to do">
      <button type="button" data-mode="clear" aria-pressed="${mode === "clear"}">Clear out for selling</button>
      <button type="button" data-mode="tidy" aria-pressed="${mode === "tidy"}">Tidy the bank</button>
    </div>
    <p class="muted">${mode === "clear"
      ? "Takes what the cleanup plan deposits, uses, sells or salvages out of the bank and into your bags. Then deposit, sell and salvage in game as usual."
      : "Sorts what stays in the bank into the suggested tabs."}</p>
    ${mode === "clear" ? `<label class="row"><input type="checkbox" id="mcDestroys"${withDestroys ? " checked" : ""}> Also set up destroys (one press each, and you confirm)</label>` : ""}`;
  if (!plan) return `${choice}<p>Hold <kbd>${esc(keyName("step"))}</kbd> in the game to run. Let go to stop; a tap does one step.</p>`;
  const { steps, i } = runner.state;
  const total = steps.length;
  const notes = [
    plan.left ? `<p class="notice">${plural(plan.left, "more item")} will wait until your bags have room. Deal with these, press Refresh, then plan again.</p>` : "",
    plan.pending ? `<p class="notice">The cleanup plan still has ${plural(plan.pending, "bank stack")} to deal with. Clear out first and there'll be fewer moves.</p>` : "",
    plan.unplaced ? `<p class="notice">${plural(plan.unplaced, "stack")} can't reach its place without landing on another stack of the same item. Free a bank slot and plan again.</p>` : "",
    blocked ? `<p class="notice"><strong>Stopped.</strong> ${esc(blocked)}</p>` : "",
  ].join("");
  if (i >= total) return `${choice}<p><span class="badge ok">Done</span> ${total ? "Every step is finished." : "Nothing to do."} Press Refresh in the Bank tab in a few minutes to see it.</p>${notes}`;
  return `${choice}<p>Step ${i + 1} of ${total}. Hold <kbd>${esc(keyName("step"))}</kbd> to run, let go to stop.</p>${notes}
    <ol class="nextsteps">${steps.slice(i, i + 5).map((s, k) => `<li${k === 0 ? ' class="now"' : ""}>${esc(stepText(s))}</li>`).join("")}</ol>`;
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <div><h2 class="section">Bank macro</h2>
      <p class="lead">Moves items for you while you hold a key, checking every slot's icon before and after each move. It stops the moment something looks wrong or you let go, and it never confirms anything.</p></div>
    ${isDesktop ? "" : `<p class="notice">The macro only works in the desktop app. Here you can look around, but nothing will move.</p>`}
    ${setupHTML()}
    <section class="card">
      <h3>2. Run</h3>
      <div id="mcRun">${runHTML()}</div>
      <div class="row"><button type="button" class="btn ghost small" id="mcRebuild">Plan again</button></div>
    </section>
    <section class="card"><h3>What happened</h3><ol class="mclog" id="mcLog"></ol></section>
    <p class="muted small-print">Keys: <kbd>${esc(keyName("calibrate"))}</kbd> find, <kbd>${esc(keyName("step"))}</kbd> hold to run, <kbd>${esc(keyName("stop"))}</kbd> stop, <kbd>${esc(keyName("typeName"))}</kbd> type a destroyed item's name. ArenaNet allows attended macros: stay at the keyboard while it runs.</p>`;
  renderLog();
}

function renderLog() {
  const el = root?.querySelector("#mcLog");
  if (!el) return;
  el.innerHTML = log.length ? log.map(l => `<li class="${l.tone}"><span class="muted">${l.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> ${esc(l.msg)}</li>`).join("")
    : `<li class="muted">Nothing yet.</li>`;
}

const refreshRun = () => { const el = root?.querySelector("#mcRun"); if (el) el.innerHTML = runHTML(); };

/* ---------- Panel ---------- */

export default {
  id: "macro",
  title: "Macro",
  mount(el, context) {
    root = el;
    ctx = context;
    $ = sel => root.querySelector(sel);
    root.addEventListener("click", onClick);
    root.addEventListener("change", e => {
      if (e.target.id === "mcCols") calib.cols = Math.max(2, Math.min(30, +e.target.value || 10));
      if (e.target.id === "mcDestroys") { withDestroys = e.target.checked; plan = null; refreshRun(); }
    });
    // A new load starts over; the same account updating later (collections arriving) keeps the run going.
    ctx.onAccount(a => {
      if (a === lastAccount) return;
      lastAccount = a;
      runner.load([], []);
      plan = null;
      blocked = "";
      render();
    });
    lastAccount = ctx.getAccount();
    render();
  },
  show() { render(); },
  hide() { disarm(); },
};

async function onClick(e) {
  const t = e.target;
  if (t.closest("#mcStart")) {
    if (armed()) { await disarm(); say("Stopped."); return; }
    if (await arm()) { finding = "bank"; manual = null; say(`Hover over the middle of the first slot of the top bank tab you can see and press ${keyName("calibrate")}.`); }
    render();
    return;
  }
  if (t.closest("#mcSkipInv")) { finding = null; say("Working in the bank only."); render(); return; }
  const markBtn = t.closest("[data-mark]");
  if (markBtn) {
    if (!armed()) { say("Press Start first so the keys are on.", "bad"); return; }
    if (markBtn.dataset.mark !== "first" && markBtn.dataset.mark !== "rest" && !calib.pitch) { say("Mark tab 1 first.", "bad"); return; }
    finding = null;
    manual = { what: markBtn.dataset.mark, tab: +markBtn.dataset.tab || null };
    render();
    return;
  }
  const m = t.closest("[data-mode]");
  if (m) { mode = m.dataset.mode; plan = null; runner.load([], []); refreshRun(); return; }
  if (t.closest("#mcRebuild")) { planSteps().catch(err => say(String(err.message || err), "bad")); }
}
