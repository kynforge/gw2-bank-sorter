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
    return fps.map((fp, k) => io.judge(fp, sigs[k], phases[k]));
  }

  async function next() {
    const step = state.steps[state.i];
    if (!step) { await io.hideMarkers(); return { ok: true, done: true, message: "All steps are done." }; }
    if (!(await io.foreground())) return fail("Guild Wars 2 isn't the window in front. Click into the game, then press the key again.");
    const rest = io.rest();
    if (!rest) return fail("Mark a spot on open ground first (step 2). The pointer rests there while slots are checked, and destroyed items are dropped there.");
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

  return {
    state,
    load(steps, model) { Object.assign(state, { steps, i: 0, model: [...model], lastDestroy: null }); },
    next,
    typeName,
  };
}
