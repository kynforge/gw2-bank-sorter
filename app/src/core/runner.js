// The bank macro's step runner: one step per key press, and the checks around it. All screen and
// input access goes through `io`, so these rules are tested without the game:
//   - Guild Wars 2 must be the window in front, or nothing happens.
//   - The pointer rests on open ground before any check (no item tooltips over the slots),
//     and the overlay's markers are hidden whenever the screen is read.
//   - Both slots must look as planned before a drag; after it they must look swapped.
//   - A destroy step only drags the item out; typing its name is a separate key press within
//     20 seconds, and confirming is always the player's click.
import { applyMove } from "./arrange.js";

export const TYPE_WINDOW = 20_000;
const where = i => `tab ${Math.floor(i / 30) + 1} slot ${(i % 30) + 1}`;

export function createRunner(io, { keys, settle = 350, retries = 3, retryDelay = 400 } = {}) {
  // Key names for messages; a function lets them follow the player's settings.
  const key = name => (typeof keys === "function" ? keys() : keys)[name];
  const state = { steps: [], i: 0, model: [], lastDestroy: null };
  const fail = (message, extra = {}) => ({ ok: false, tone: "bad", message, ...extra });

  async function check(indexes, sigs, phases) {
    await io.hideMarkers();
    const fps = await io.capture(indexes);
    return fps.map((fp, k) => io.judge(fp, sigs[k], phases[k], indexes[k]));
  }

  async function next() {
    const step = state.steps[state.i];
    if (!step) { await io.hideMarkers(); return { ok: true, done: true, message: "All steps are done." }; }
    if (!(await io.foreground())) return fail("Guild Wars 2 isn't the window in front. Click into the game, then press the key again.");
    const rest = io.rest();
    if (!rest) return fail("Mark a spot on open ground first (step 2). The pointer rests there while slots are checked, and destroyed items are dropped there.");

    // Scroll the bank so the slots this step needs are on screen. Two tabs too far apart to show
    // together are bridged through an empty bag slot: the item goes to the bag, then to its place,
    // and whatever was there goes back to where the item came from (the same result as a swap).
    if (io.ensureVisible) {
      const need = step.kind === "destroy" ? [step.from] : [step.from, step.to];
      const seen = await io.ensureVisible(need);
      if (!seen.ok) {
        // A carry-through step is never split again: if even that can't be shown, stop.
        if (step.kind !== "move" || step.hop || need.length < 2 || !io.spareSlot) return fail(seen.reason);
        const spare = io.spareSlot(state.model);
        if (spare == null || spare < 0) return fail(`Those two bank tabs can't be on screen together, and there's no empty bag slot to carry the item through. Free a bag slot, or make the bank window taller.`);
        const hops = [{ ...step, to: spare, hop: true }, { ...step, from: spare, hop: true }];
        if (state.model[step.to]) hops.push({ kind: "move", from: spare, to: step.from, hop: true, item: null });
        state.steps.splice(state.i, 1, ...hops);
        return next();
      }
    }

    const from = io.position(step.from);
    const to = step.kind === "destroy" ? rest : io.position(step.to);
    if (!from) return fail(`${where(step.from).replace(/ slot.*/, "")} isn't marked. Scroll so it's visible and mark it in step 2.`);
    if (!to) return fail(`${where(step.to).replace(/ slot.*/, "")} isn't marked. Scroll so it's visible and mark it in step 2.`);
    await io.park(rest);
    const m = state.model;

    if (step.kind === "destroy") {
      const [src] = await check([step.from], [m[step.from]], ["destroy-from"]);
      if (!src.ok) return fail(`Before destroying: ${src.reason} Nothing was moved.`);
      await io.drag(from, rest, rest);
      const name = io.itemName(m[step.from]);
      m[step.from] = null;
      state.lastDestroy = { name, at: io.now() };
      state.i++;
      return { ok: true, tone: "warn", message: `Dragged ${name} out. If the game asks for its name, press ${key("typeName")}. Then click Yes yourself, or No to keep it.` };
    }

    const [a, b] = await check([step.from, step.to], [m[step.from], m[step.to]], ["before-from", "before-to"]);
    if (!a.ok) return fail(`Before moving: ${a.reason} Nothing was moved.`);
    if (!b.ok) return fail(`Before moving, the destination: ${b.reason} Nothing was moved.`);
    await io.drag(from, to, rest);
    // The two slots should now have traded places. A slow redraw gets a few more looks.
    let after = [];
    for (let attempt = 0; attempt <= retries; attempt++) {
      await io.wait(attempt === 0 ? settle : retryDelay);
      after = await check([step.from, step.to], [m[step.to], m[step.from]], ["after", "after"]);
      if (after.every(r => r.ok)) break;
    }
    if (!after.every(r => r.ok)) {
      const bad = after.find(r => !r.ok);
      return fail(`The move didn't land as expected (${bad.reason}). Press Refresh in the Bank tab, wait a few minutes, then Verify again.`, { replan: true });
    }
    applyMove(m, step);
    state.i++;
    io.showMarkers(state.steps[state.i]);
    return { ok: true, tone: "ok", message: `Moved ${io.itemName(m[step.to])}.` };
  }

  async function typeName() {
    const d = state.lastDestroy;
    if (!d || io.now() - d.at > TYPE_WINDOW) return fail(`${key("typeName")} only types the name within 20 seconds of a destroy step.`);
    if (!(await io.foreground())) return fail("Guild Wars 2 isn't the window in front, so nothing was typed.");
    await io.typeText(d.name);
    state.lastDestroy = null;
    return { ok: true, tone: "warn", message: `Typed "${d.name}". Check it, then click Yes yourself.` };
  }

  // Hold to run: the press does one step, and more follow only while the key is still held down.
  // A destroy is never part of a held run: it waits for its own press, and the run ends after it,
  // because the game's prompt needs the player.
  async function runWhileHeld({ stillHeld, onStep } = {}) {
    let steps = 0;
    for (;;) {
      const step = state.steps[state.i];
      if (!step) { await io.hideMarkers(); return { ok: true, done: true, steps, message: steps ? `Done: ${steps} step${steps === 1 ? "" : "s"}. All steps are finished.` : "All steps are done." }; }
      if (steps > 0 && step.kind === "destroy") return { ok: true, steps, message: `Next is a destroy. Let go, then press ${key("step")} once for it.` };
      if (steps > 0 && !(await stillHeld())) return { ok: true, steps, message: `Stopped after ${steps} step${steps === 1 ? "" : "s"}: you let go.` };
      const res = await next();
      onStep?.(res);
      if (!res.ok) return { ...res, steps };
      steps++;
      if (step.kind === "destroy") return { ...res, steps };
    }
  }

  return {
    state,
    load(steps, model) { Object.assign(state, { steps, i: 0, model: [...model], lastDestroy: null }); },
    next,
    typeName,
    runWhileHeld,
  };
}
