// The Macro panel: tidies the bank one move per key press, and checks every slot's icon before and
// after it moves anything. It never confirms anything: on a destroy prompt, the player clicks Yes.
// The step rules themselves live in core/runner.js, where they're tested.
import { esc, plural } from "../core/format.js";
import { TAB_SIZE } from "../core/account.js";
import { analyze } from "../core/bank.js";
import { recipeUses } from "../core/recipes.js";
import { planArrangement, planMoves, applyMove, signature, unplacedCount } from "../core/arrange.js";
import { judge } from "../core/matcher.js";
import { createRunner } from "../core/runner.js";
import { registerAll } from "../core/keys.js";
import {
  pitchFrom, slotCenter, slotSize, averageFingerprints,
  calibrationKey, loadCalibration, saveCalibration, emptyCalibration,
} from "../core/calibration.js";
import { loadBankPrefs } from "./bank.js";
import { isDesktop, invoke, hotkeys, markers } from "../platform.js";

let root, ctx, $;
const calKey = () => calibrationKey(screen.width * devicePixelRatio, screen.height * devicePixelRatio);
let calib = loadCalibration(calKey());
let registered = [];           // hotkeys currently held, released as one
let capture = null;            // what the next calibration key press marks: { what, tab? }
let firstPoint = null;
let iconFps = new Map();       // item id -> fingerprint
let verify = null;             // { byIndex: Map(index -> "ok"|"bad"|"empty-ok"), matched, total }
let plan = null;               // { pending, unplaced } once steps are planned
let blocked = "";
let busy = false;
let lastAccount = null;
const log = [];

const armed = () => registered.length > 0;
const itemIdOf = sig => sig ? +sig.split("|")[0] : null;
const nameOf = sig => sig ? (ctx.getAccount()?.items.get(itemIdOf(sig))?.name || `item ${itemIdOf(sig)}`) : "an empty slot";

/* ---------- The runner's view of the game ---------- */

const runner = createRunner({
  foreground: () => invoke("gw2_foreground"),
  position: i => slotCenter(calib, i),
  rest: () => calib.drop,
  park: to => invoke("park_pointer", { to }),
  hideMarkers: () => markers.hide(),
  showMarkers: step => showStepMarkers(step),
  capture: indexes => fingerprintsAt(indexes),
  judge: (fp, sig) => {
    const exp = expectation(sig);
    if (exp !== "empty" && !exp.fp) return { ok: false, reason: `There's no icon to compare ${exp.key} with.` };
    return judge(fp, exp, candidatesFor(runner.state.model), calib.emptyFp);
  },
  drag: (from, to, park) => invoke("drag", { from, to, park }),
  wait: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
  typeText: text => invoke("type_text", { text }),
  itemName: nameOf,
}, { keys: () => ctx.settings.hotkeys });

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
    });
    // A new load starts over; the same account updating later (collections arriving) keeps the run going.
    ctx.onAccount(a => {
      if (a === lastAccount) return;
      lastAccount = a;
      runner.load([], []);
      plan = null;
      verify = null;
      blocked = "";
      render();
    });
    lastAccount = ctx.getAccount();
    render();
  },
  show() {
    const key = calKey();
    if (loadCalibration(key).pitch !== calib.pitch) calib = loadCalibration(key);   // another screen size
    render();
  },
  hide() { disarm(); },
};

/* ---------- Rendering ---------- */

const keyName = k => ctx.settings.hotkeys[k];
const tabsMarked = () => Object.keys(calib.tabs).map(Number).sort((a, b) => a - b);

function say(msg, tone = "") {
  log.unshift({ msg, tone, at: new Date() });
  log.length = Math.min(log.length, 8);
  renderLog();
}

function render() {
  if (!root) return;
  const account = ctx.getAccount();
  const bankTabs = account ? Math.ceil(account.bank.length / TAB_SIZE) : 0;
  const marked = tabsMarked();
  root.innerHTML = `
    <div><h2 class="section">Bank macro</h2>
      <p class="lead">Tidies your bank into the suggested tabs, one move per key press. Before and after every move it checks the slots' icons on screen, and it stops if anything looks wrong. It never clicks confirm or presses Enter.</p></div>
    ${isDesktop ? "" : `<p class="notice">The macro only works in the desktop app. Here you can look around, but nothing will move.</p>`}

    <section class="card">
      <h3>1. Keys</h3>
      <p>${armed() ? `<span class="badge ok">Armed</span> The keys below work while you're in the game.` : "Arm the keys when your bank is open in game. They stop working when you leave this tab."}</p>
      <ul class="keys">
        <li><kbd>${esc(keyName("calibrate"))}</kbd> mark a point while calibrating</li>
        <li><kbd>${esc(keyName("step"))}</kbd> do the next step</li>
        <li><kbd>${esc(keyName("stop"))}</kbd> stop and disarm</li>
        <li><kbd>${esc(keyName("typeName"))}</kbd> type the item's name into a destroy prompt</li>
      </ul>
      <div class="row"><button type="button" class="btn${armed() ? " ghost" : ""}" id="mcArm">${armed() ? "Disarm keys" : "Arm keys"}</button></div>
    </section>

    <section class="card">
      <h3>2. Show me where your bank is</h3>
      <p class="muted">Open the bank in game and scroll so the tabs you want to sort are visible. Positions are saved for this screen size.</p>
      <ol class="steps-list">
        <li>Slots per row in your bank window <input type="number" id="mcCols" class="input narrow" min="2" max="30" value="${calib.cols}"></li>
        <li>Mark tab 1: <button type="button" class="btn ghost small" data-cap="first" data-tab="1">Start</button> then hover the <b>first slot</b> of the tab and press <kbd>${esc(keyName("calibrate"))}</kbd>, then the <b>last slot in that row</b> and press it again.</li>
        <li>Other visible tabs: pick one, hover its first slot and press <kbd>${esc(keyName("calibrate"))}</kbd>.
          <div class="filters">${Array.from({ length: Math.max(0, bankTabs - 1) }, (_, k) => k + 2).map(t =>
            `<button type="button" class="chip all" data-cap="tab" data-tab="${t}" aria-pressed="${marked.includes(t)}">Tab ${t}</button>`).join("")}</div></li>
        <li><button type="button" class="btn ghost small" data-cap="drop">Mark a spot on open ground</button> then hover the game world, away from any window, and press <kbd>${esc(keyName("calibrate"))}</kbd>. The pointer rests there while slots are checked, so item tooltips stay out of the way, and destroyed items are dropped there.</li>
      </ol>
      <p id="mcCapture" class="${capture ? "notice" : "muted"}">${capture ? esc(captureText()) : calib.pitch ? `Marked: ${marked.length ? marked.map(t => `tab ${t}`).join(", ") : "no tabs"}${calib.drop ? ", the open-ground spot" : ""}. Slot spacing ${calib.pitch.toFixed(1)} px.` : "Nothing marked yet."}</p>
      <div class="row">${calib.pitch ? `<button type="button" class="btn ghost small" id="mcShowCal">Show marked slots</button><button type="button" class="btn ghost small" id="mcResetCal">Start over</button>` : ""}</div>
    </section>

    <section class="card">
      <h3>3. Check the icons</h3>
      <p class="muted">Compares every marked slot with what the API says is there, and learns what an empty slot looks like. Nothing moves.</p>
      <div class="row"><button type="button" class="btn ghost" id="mcVerify"${calib.pitch && marked.length ? "" : " disabled"}>Verify</button></div>
      <div id="mcVerifyOut">${verifyHTML()}</div>
    </section>

    <section class="card">
      <h3>4. Sort</h3>
      <div id="mcRun">${runHTML()}</div>
      <div class="row"><button type="button" class="btn ghost small" id="mcRebuild">Plan the steps again</button></div>
    </section>

    <section class="card"><h3>What happened</h3><ol class="mclog" id="mcLog"></ol></section>
    <p class="muted small-print">ArenaNet allows attended macros where each key press does one thing. Stay at the keyboard while you use it.</p>`;
  renderLog();
}

function captureText() {
  const k = keyName("calibrate");
  if (capture.what === "first") return `Hover the first slot of tab ${capture.tab} and press ${k}.`;
  if (capture.what === "rowEnd") return `Now hover the last slot in that row and press ${k}.`;
  if (capture.what === "tab") return `Hover the first slot of tab ${capture.tab} and press ${k}.`;
  return `Hover open ground in the game world and press ${k}.`;
}

function verifyHTML() {
  if (!verify) return "";
  const pct = verify.total ? Math.round((verify.matched / verify.total) * 100) : 0;
  const tabs = [...new Set([...verify.byIndex.keys()].map(i => Math.floor(i / TAB_SIZE) + 1))];
  return `<p>${verify.matched} of ${plural(verify.total, "slot")} match (${pct}%).${pct < 90 ? " If many don't, press Refresh in the Bank tab (the API can be a few minutes behind), or mark the tabs again." : ""}${verify.emptyLearned ? "" : " There was no empty slot to learn from, so moves onto empty slots will be refused."}</p>
    ${tabs.map(t => `<div class="vgrid" style="--cols:${calib.cols}" aria-label="Tab ${t}"><span class="vlabel">Tab ${t}</span>${Array.from({ length: TAB_SIZE }, (_, p) => {
      const r = verify.byIndex.get((t - 1) * TAB_SIZE + p);
      return `<span class="vcell ${r || ""}" title="Slot ${p + 1}${r === "bad" ? ": doesn't match" : ""}"></span>`;
    }).join("")}</div>`).join("")}`;
}

function stepText(step) {
  const where = i => `tab ${Math.floor(i / TAB_SIZE) + 1} slot ${(i % TAB_SIZE) + 1}`;
  const name = step.item?.name || "an item";
  if (step.kind === "destroy") return `Set up destroying ${name} from ${where(step.from)}`;
  const occupant = runner.state.model[step.to];
  return `Move ${name} from ${where(step.from)} to ${where(step.to)}${occupant ? ` (swaps with ${nameOf(occupant)})` : ""}`;
}

function runHTML() {
  if (!ctx.getAccount()) return `<p class="muted">Loading…</p>`;
  if (!plan) return `<p class="muted">Steps are planned when you first press ${esc(keyName("step"))}, or with the button below.</p>`;
  const { steps, i } = runner.state;
  const total = steps.length;
  const destroys = steps.filter(s => s.kind === "destroy").length;
  const unplaced = plan.unplaced ? `<p class="notice">${plural(plan.unplaced, "stack")} can't reach the suggested place without being dropped onto another stack of the same item, which would merge them. Free a slot in the bank and plan again.</p>` : "";
  if (i >= total) {
    return `<p><span class="badge ok">Done</span> ${!total && !plan.unplaced ? "Your bank is already in order." : plan.unplaced ? "Everything that could be moved has been." : "Every step is finished."} Press Refresh in the Bank tab in a few minutes to see it.</p>${unplaced}`;
  }
  const next = steps.slice(i, i + 5);
  return `<p>${plural(total - destroys, "move")}${destroys ? ` and ${plural(destroys, "destroy setup")}` : ""}. Step ${i + 1} of ${total}.</p>
    ${plan.pending ? `<p class="notice">The cleanup plan still has ${plural(plan.pending, "bank stack")} to deposit, sell, use or salvage. Do those first and press Refresh, and there'll be fewer moves.</p>` : ""}
    ${unplaced}
    ${blocked ? `<p class="notice"><strong>Stopped.</strong> ${esc(blocked)}</p>` : ""}
    <ol class="nextsteps">${next.map((s, k) => `<li${k === 0 ? ' class="now"' : ""}>${esc(stepText(s))}</li>`).join("")}</ol>
    <p class="muted">Press <kbd>${esc(keyName("step"))}</kbd> in the game for the next step.</p>`;
}

function renderLog() {
  const el = root?.querySelector("#mcLog");
  if (!el) return;
  el.innerHTML = log.length ? log.map(l => `<li class="${l.tone}"><span class="muted">${l.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> ${esc(l.msg)}</li>`).join("")
    : `<li class="muted">Nothing yet.</li>`;
}

const refreshRun = () => { const el = root?.querySelector("#mcRun"); if (el) el.innerHTML = runHTML(); };

/* ---------- Keys ---------- */

async function arm() {
  const k = ctx.settings.hotkeys;
  try {
    registered = await registerAll([
      [k.calibrate, onCalibrateKey], [k.step, onStepKey], [k.stop, onStopKey], [k.typeName, onTypeKey],
    ], hotkeys);
    say("Keys armed.");
  } catch (err) {
    registered = [];
    say(`Couldn't arm the keys: ${err.message || err}. Another program may be using one of them; pick different keys in Settings.`, "bad");
  }
  render();
}

async function disarm() {
  const held = registered;
  registered = [];
  for (const accel of held) await hotkeys.unregister(accel);
  capture = null;
  markers.hide();
  if (held.length && root && !root.hidden) render();
}

/* ---------- Calibration ---------- */

async function onCalibrateKey() {
  if (!capture) { say(`Press a "Start" or tab button in the Macro tab first, then ${keyName("calibrate")}.`); return; }
  let pos;
  try { pos = await invoke("cursor_pos"); }
  catch (err) { say(String(err.message || err), "bad"); return; }
  const what = capture.what;
  if (what === "first") {
    firstPoint = pos;
    capture = { what: "rowEnd", tab: capture.tab };
    say("First slot marked.");
  } else if (what === "rowEnd") {
    try {
      calib.pitch = pitchFrom(firstPoint, pos, calib.cols);
      calib.tabs = { 1: firstPoint };
      calib.emptyFp = null;
      verify = null;
      capture = null;
      say(`Tab 1 marked. Slots are ${calib.pitch.toFixed(1)} px apart.`, "ok");
    } catch (err) {
      capture = { what: "first", tab: 1 };
      say(err.message, "bad");
    }
  } else if (what === "tab") {
    calib.tabs[capture.tab] = pos;
    say(`Tab ${capture.tab} marked.`, "ok");
    capture = null;
  } else if (what === "drop") {
    calib.drop = pos;
    say("Open-ground spot marked.", "ok");
    capture = null;
  }
  saveCalibration(calKey(), calib);
  plan = null;
  runner.load([], []);
  render();
}

function showMarkedSlots() {
  const rings = tabsMarked().flatMap(t => [0, calib.cols - 1, TAB_SIZE - 1].map(p => {
    const c = slotCenter(calib, (t - 1) * TAB_SIZE + p);
    return { x: c[0], y: c[1], size: Math.round(calib.pitch), label: p === 0 ? `Tab ${t}` : "" };
  }));
  if (calib.drop) rings.push({ x: calib.drop[0], y: calib.drop[1], size: Math.round(calib.pitch), label: "Open ground", tone: "warn" });
  markers.show(rings, { hideAfter: 6000 });
}

/* ---------- Seeing the screen ---------- */

// Reads slots off the screen. Markers are always hidden first: the overlay's own rings would spoil the match.
async function fingerprintsAt(indexes) {
  await markers.hide();
  const size = slotSize(calib);
  const rects = indexes.map(i => { const [x, y] = slotCenter(calib, i); return [x, y, size]; });
  return (await invoke("screen_fingerprints", { rects })).map(fp => Uint8Array.from(fp));
}

async function loadIcons(ids) {
  const account = ctx.getAccount();
  const todo = [...new Set(ids)].filter(id => !iconFps.has(id) && account.items.get(id)?.icon);
  if (!todo.length) return;
  const fps = await invoke("icon_fingerprints", { urls: todo.map(id => account.items.get(id).icon) });
  todo.forEach((id, k) => { if (fps[k]) iconFps.set(id, Uint8Array.from(fps[k])); });
}

const markedIndexes = () => tabsMarked().flatMap(t => Array.from({ length: TAB_SIZE }, (_, p) => (t - 1) * TAB_SIZE + p))
  .filter(i => i < (ctx.getAccount()?.bank.length || 0));

function expectation(sig) {
  if (!sig) return "empty";
  return { key: nameOf(sig), fp: iconFps.get(itemIdOf(sig)) };
}
const candidatesFor = model => [...new Set(model.filter(Boolean).map(itemIdOf))]
  .filter(id => iconFps.has(id)).map(id => ({ key: ctx.getAccount().items.get(id)?.name || `item ${id}`, fp: iconFps.get(id) }));

async function runVerify() {
  const account = ctx.getAccount();
  const indexes = markedIndexes();
  if (!indexes.length) return;
  say("Checking the marked slots…");
  try {
    if (calib.drop) await invoke("park_pointer", { to: calib.drop }).catch(() => {});
    await loadIcons(indexes.map(i => account.bank[i]?.id).filter(Boolean));
    const fps = await fingerprintsAt(indexes);
    const empties = indexes.map((i, k) => (account.bank[i] ? null : fps[k])).filter(Boolean);
    calib.emptyFp = averageFingerprints(empties);
    saveCalibration(calKey(), calib);
    const model = account.bank.map(signature);
    const cands = candidatesFor(model);
    const byIndex = new Map();
    let matched = 0;
    indexes.forEach((i, k) => {
      const exp = expectation(model[i]);
      const ok = exp !== "empty" && !exp.fp ? false : judge(fps[k], exp, cands, calib.emptyFp).ok;
      byIndex.set(i, ok ? (exp === "empty" ? "empty-ok" : "ok") : "bad");
      if (ok) matched++;
    });
    verify = { byIndex, matched, total: indexes.length, emptyLearned: !!calib.emptyFp };
    say(`${matched} of ${indexes.length} slots match.`, matched === indexes.length ? "ok" : "");
  } catch (err) {
    say(`Couldn't check the slots: ${err.message || err}`, "bad");
  }
  render();
}

/* ---------- Planning ---------- */

async function planSteps() {
  const account = ctx.getAccount();
  const prefs = loadBankPrefs(account);
  let result = analyze(account, prefs);
  const destroyIds = [...new Set(result.slots.filter(s => s.action === "destroy").map(s => s.slot.id))];
  if (destroyIds.length) {
    const uses = await recipeUses(destroyIds).catch(() => null);
    result = analyze(account, prefs, { recipeUses: uses });
  }
  // Destroys first (only with an open-ground spot to drop on), then the arrangement of what's left.
  const destroys = !calib.drop ? [] : result.slots
    .filter(s => s.kind === "bank" && s.action === "destroy")
    .map(s => ({ kind: "destroy", from: (s.tab - 1) * TAB_SIZE + (s.pos - 1), item: s.item }));
  const gone = new Set(destroys.map(d => d.from));
  const remaining = account.bank.map((slot, i) => (gone.has(i) ? null : slot));
  const start = remaining.map(signature);
  const target = planArrangement(remaining, account.items, account.storable);
  const moves = planMoves(start, target).map(m => ({ kind: "move", ...m }));
  // Each move's item is whatever sits in its source slot once the earlier moves have happened.
  const sim = [...start];
  for (const m of moves) { m.item = account.items.get(itemIdOf(sim[m.from])); applyMove(sim, m); }
  // The model starts from the bank as the API saw it; destroy steps empty their slots as they run.
  runner.load([...destroys, ...moves], account.bank.map(signature));
  plan = {
    // Bank stacks the cleanup plan would still deposit, sell, use or salvage: sorting them first is wasted moves.
    pending: result.slots.filter(s => s.kind === "bank" && s.action !== "keep" && s.action !== "empty" && s.action !== "destroy").length,
    unplaced: unplacedCount(start, target, moves),
  };
  blocked = "";
  say(`Planned ${plural(moves.length, "move")}${destroys.length ? ` and ${plural(destroys.length, "destroy setup")}` : ""}.${!calib.drop ? " Mark a spot on open ground before you start." : ""}`);
  showStepMarkers(runner.state.steps[0]);
  refreshRun();
}

function showStepMarkers(step) {
  if (!step || !calib.pitch) { markers.hide(); return; }
  const from = slotCenter(calib, step.from);
  const to = step.kind === "destroy" ? calib.drop : slotCenter(calib, step.to);
  const size = Math.round(calib.pitch);
  const rings = [];
  if (from) rings.push({ x: from[0], y: from[1], size, label: step.kind === "destroy" ? "Destroy this" : "From" });
  if (to) rings.push({ x: to[0], y: to[1], size, label: step.kind === "destroy" ? "Drop" : "To", tone: step.kind === "destroy" ? "warn" : "to" });
  markers.show(rings);
}

/* ---------- Running ---------- */

async function onStepKey() {
  if (busy) return;
  busy = true;
  try {
    const account = ctx.getAccount();
    if (!account) return;
    if (!plan) await planSteps();
    await loadIcons(runner.state.model.filter(Boolean).map(itemIdOf));
    const res = await runner.next();
    blocked = res.ok ? "" : res.message;
    say(res.message, res.tone || "");
    if (res.replan) plan = null;   // the bank no longer matches the plan; plan again from fresh data next time
    refreshRun();
  } catch (err) {
    blocked = `Something went wrong: ${err.message || err}. Nothing more will move until you press ${keyName("step")} again.`;
    say(blocked, "bad");
    refreshRun();
  } finally {
    busy = false;
  }
}

async function onTypeKey() {
  try {
    const res = await runner.typeName();
    say(res.message, res.tone || "");
  } catch (err) {
    say(`Couldn't type the name: ${err.message || err}`, "bad");
  }
}

async function onStopKey() {
  blocked = "Stopped with the stop key. Arm the keys again to carry on.";
  say("Stopped.");
  await disarm();
}

/* ---------- Clicks ---------- */

function onClick(e) {
  const t = e.target;
  if (t.closest("#mcArm")) { armed() ? disarm() : arm(); return; }
  const cap = t.closest("[data-cap]");
  if (cap) {
    if (!armed()) { say("Arm the keys first (step 1).", "bad"); return; }
    if (cap.dataset.cap !== "first" && !calib.pitch) { say("Mark tab 1 first.", "bad"); return; }
    capture = { what: cap.dataset.cap, tab: +cap.dataset.tab || null };
    render();
    return;
  }
  if (t.closest("#mcResetCal")) { calib = { ...emptyCalibration(), cols: calib.cols }; saveCalibration(calKey(), calib); verify = null; plan = null; runner.load([], []); say("Calibration cleared."); render(); return; }
  if (t.closest("#mcShowCal")) { showMarkedSlots(); return; }
  if (t.closest("#mcVerify")) { runVerify(); return; }
  if (t.closest("#mcRebuild")) { planSteps().catch(err => say(String(err.message || err), "bad")); }
}
