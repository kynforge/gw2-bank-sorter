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
