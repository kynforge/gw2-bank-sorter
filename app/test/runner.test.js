import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunner, TYPE_WINDOW } from "../src/core/runner.js";

// A fake game: slot positions, what each check says, and a log of every call in order.
function fakeIo({ front = true, rest = [900, 900], judgeFn = () => ({ ok: true, reason: "" }), clock = { t: 0 } } = {}) {
  const calls = [];
  const io = {
    calls, clock,
    foreground: async () => { calls.push("foreground"); return front; },
    position: i => [100 + (i % 10) * 40, 100 + Math.floor(i / 10) * 40],
    rest: () => rest,
    park: async p => { calls.push(["park", p]); },
    hideMarkers: async () => { calls.push("hide"); },
    showMarkers: () => { calls.push("show"); },
    capture: async idx => { calls.push(["capture", idx]); return idx.map(() => new Uint8Array(192)); },
    judge: (fp, sig, phase) => judgeFn(sig, phase, calls),
    drag: async (from, to, park) => { calls.push(["drag", from, to, park]); },
    wait: async ms => { calls.push(["wait", ms]); },
    now: () => clock.t,
    typeText: async text => { calls.push(["type", text]); },
    itemName: sig => (sig ? `Item ${sig.split("|")[0]}` : "an empty slot"),
  };
  return io;
}
const keys = { step: "F8", typeName: "F10" };
const named = (calls, name) => calls.filter(c => (Array.isArray(c) ? c[0] : c) === name);

test("markers are hidden before every capture", async () => {
  const io = fakeIo();
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }, { kind: "move", from: 2, to: 3 }], ["1|", "2|", "3|", null]);
  await r.next();
  await r.next();
  let hidden = false;
  for (const c of io.calls) {
    if (c === "hide") hidden = true;
    if (c === "show") hidden = false;
    if (Array.isArray(c) && c[0] === "capture") assert.ok(hidden, "a capture happened while markers were showing");
  }
});

test("the pointer is parked on open ground before checking and after dragging", async () => {
  const io = fakeIo();
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }], ["1|", "2|"]);
  await r.next();
  const firstPark = io.calls.findIndex(c => c[0] === "park");
  const firstCapture = io.calls.findIndex(c => c[0] === "capture");
  assert.ok(firstPark >= 0 && firstPark < firstCapture);
  assert.deepEqual(named(io.calls, "drag")[0][3], [900, 900]);
});

test("a source mismatch stops without dragging", async () => {
  const io = fakeIo({ judgeFn: (sig, phase) => ({ ok: phase !== "before-from", reason: "The slot looks more like X than Y." }) });
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }], ["1|", "2|"]);
  const res = await r.next();
  assert.equal(res.ok, false);
  assert.match(res.message, /Nothing was moved/);
  assert.equal(named(io.calls, "drag").length, 0);
  assert.equal(r.state.i, 0);
});

test("not in front: nothing is captured or dragged", async () => {
  const io = fakeIo({ front: false });
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }], ["1|", "2|"]);
  const res = await r.next();
  assert.equal(res.ok, false);
  assert.match(res.message, /isn't the window in front/);
  assert.equal(named(io.calls, "capture").length + named(io.calls, "drag").length, 0);
});

test("no open-ground spot: stops before anything", async () => {
  const io = fakeIo({ rest: null });
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }], ["1|", "2|"]);
  const res = await r.next();
  assert.equal(res.ok, false);
  assert.match(res.message, /open ground/);
  assert.equal(named(io.calls, "drag").length, 0);
});

test("after-check retries before giving up", async () => {
  let afterChecks = 0;
  const io = fakeIo({ judgeFn: (sig, phase) => ({ ok: !(phase === "after" && ++afterChecks <= 2), reason: "slow redraw" }) });
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }], ["1|", "2|"]);
  const res = await r.next();
  assert.equal(res.ok, true, res.message);
  assert.deepEqual(r.state.model, ["2|", "1|"]);
  assert.equal(r.state.i, 1);
});

test("a move that never lands asks for a fresh plan", async () => {
  const io = fakeIo({ judgeFn: (sig, phase) => ({ ok: phase !== "after", reason: "still the old item" }) });
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }], ["1|", "2|"]);
  const res = await r.next();
  assert.equal(res.ok, false);
  assert.equal(res.replan, true);
});

test("type name only within 20 seconds of a destroy step, and only in front", async () => {
  const clock = { t: 1000 };
  const io = fakeIo({ clock });
  const r = createRunner(io, { keys });
  r.load([{ kind: "destroy", from: 0 }], ["7|"]);
  assert.equal((await r.typeName()).ok, false, "nothing to type before a destroy step");
  const res = await r.next();
  assert.equal(res.ok, true);
  assert.deepEqual(named(io.calls, "drag")[0].slice(1, 3), [[100, 100], [900, 900]]);
  assert.equal(r.state.model[0], null);
  clock.t += TYPE_WINDOW + 1;
  assert.equal((await r.typeName()).ok, false, "too late");
  assert.equal(named(io.calls, "type").length, 0);

  const r2 = createRunner(io, { keys });
  r2.load([{ kind: "destroy", from: 0 }], ["7|"]);
  await r2.next();
  clock.t += 5000;
  const typed = await r2.typeName();
  assert.equal(typed.ok, true);
  assert.deepEqual(named(io.calls, "type").at(-1), ["type", "Item 7"]);
  assert.equal((await r2.typeName()).ok, false, "only once per destroy");
});

/* ---------- Hold to run ---------- */

const moves = n => Array.from({ length: n }, (_, k) => ({ kind: "move", from: 2 * k, to: 2 * k + 1 }));
const model = n => Array.from({ length: 2 * n }, (_, k) => `${k + 1}|`);
// The key reads as held for the first `checks` asks, then released.
const heldFor = checks => { let n = 0; return async () => n++ < checks; };

test("holding the key keeps moving, letting go stops", async () => {
  const io = fakeIo();
  const r = createRunner(io, { keys });
  r.load(moves(10), model(10));
  const res = await r.runWhileHeld({ stillHeld: heldFor(3) });
  // The press itself does the first step; three more checks said "still held".
  assert.equal(res.steps, 4);
  assert.equal(r.state.i, 4);
  assert.match(res.message, /let go/);
});

test("a quick tap does exactly one step", async () => {
  const io = fakeIo();
  const r = createRunner(io, { keys });
  r.load(moves(5), model(5));
  const res = await r.runWhileHeld({ stillHeld: heldFor(0) });
  assert.equal(res.steps, 1);
  assert.equal(named(io.calls, "drag").length, 1);
});

test("a held run stops at the first check that fails", async () => {
  let befores = 0;
  const io = fakeIo({ judgeFn: (sig, phase) => ({ ok: !(phase === "before-from" && ++befores === 3), reason: "looks wrong" }) });
  const r = createRunner(io, { keys });
  r.load(moves(10), model(10));
  const res = await r.runWhileHeld({ stillHeld: heldFor(99) });
  assert.equal(res.ok, false);
  assert.equal(res.steps, 2);
  assert.equal(named(io.calls, "drag").length, 2);
});

test("destroys never run inside a held run, and each needs its own press", async () => {
  const io = fakeIo();
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 1 }, { kind: "destroy", from: 2 }, { kind: "move", from: 3, to: 4 }], ["1|", "2|", "3|", "4|", null]);
  const first = await r.runWhileHeld({ stillHeld: heldFor(99) });
  assert.equal(first.steps, 1, "stops before the destroy");
  assert.match(first.message, /destroy/);
  const second = await r.runWhileHeld({ stillHeld: heldFor(99) });
  assert.equal(second.steps, 1, "the destroy runs alone");
  assert.equal(r.state.i, 2);
  assert.equal(named(io.calls, "drag").length, 2);
});

/* ---------- Scrolling and carrying through the bags ---------- */

test("an off-screen tab is scrolled into view before the move", async () => {
  const io = fakeIo();
  const onScreen = new Set([0, 1]);
  io.position = i => (onScreen.has(i) ? [100 + i * 40, 100] : null);
  io.ensureVisible = async need => { io.calls.push(["ensure", need]); need.forEach(i => onScreen.add(i)); return { ok: true }; };
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 70 }], Object.assign(Array(71).fill(null), { 0: "1|" }));
  const res = await r.next();
  assert.equal(res.ok, true, res.message);
  assert.deepEqual(named(io.calls, "ensure")[0][1], [0, 70]);
  assert.equal(named(io.calls, "drag").length, 1);
});

test("tabs too far apart go through an empty bag slot, and the swap still ends the same", async () => {
  const io = fakeIo();
  // Bag slots (100 and up) are always on screen; two bank tabs at once are not.
  io.ensureVisible = async need => (need.filter(i => i < 100).length > 1 ? { ok: false, reason: "too far apart" } : { ok: true });
  io.spareSlot = model => model.indexOf(null, 100);
  const r = createRunner(io, { keys });
  const model = Array(102).fill(null);
  model[0] = "1|"; model[90] = "2|";
  r.load([{ kind: "move", from: 0, to: 90 }], model);
  const res = await r.runWhileHeld({ stillHeld: async () => true });
  assert.equal(res.ok, true, res.message);
  // Three drags: item to the bag, item to its place, the displaced item back to where the first came from.
  assert.equal(named(io.calls, "drag").length, 3);
  assert.equal(r.state.model[90], "1|");
  assert.equal(r.state.model[0], "2|");
  assert.equal(r.state.model[100], null);
});

test("no free bag slot to carry through: stops and says so", async () => {
  const io = fakeIo();
  io.ensureVisible = async need => (need.length > 1 ? { ok: false, reason: "too far apart" } : { ok: true });
  io.spareSlot = () => -1;
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 90 }], Object.assign(Array(91).fill(null), { 0: "1|", 90: "2|" }));
  const res = await r.next();
  assert.equal(res.ok, false);
  assert.match(res.message, /bag slot/);
  assert.equal(named(io.calls, "drag").length, 0);
});

test("checks are told which slot they're looking at", async () => {
  const seen = [];
  const io = fakeIo({ judgeFn: () => ({ ok: true }) });
  io.judge = (fp, sig, phase, index) => { seen.push(index); return { ok: true }; };
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 3, to: 7 }], Object.assign(Array(8).fill(null), { 3: "1|" }));
  await r.next();
  assert.deepEqual(seen.slice(0, 2), [3, 7]);
});

test("if even the bag route can't be shown, it stops instead of looping", async () => {
  const io = fakeIo();
  io.ensureVisible = async () => ({ ok: false, reason: "Can't see the inventory." });
  io.spareSlot = model => model.indexOf(null, 100);
  const r = createRunner(io, { keys });
  r.load([{ kind: "move", from: 0, to: 90 }], Object.assign(Array(102).fill(null), { 0: "1|", 90: "2|" }));
  const res = await r.next();
  assert.equal(res.ok, false);
  assert.match(res.message, /inventory/);
  assert.equal(named(io.calls, "drag").length, 0);
});
