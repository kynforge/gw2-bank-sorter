// "Clear out for selling": takes what the cleanup plan deals with out of the bank and into the bags,
// so it can be deposited, used, sold or salvaged in game. Destroys come out to the bags too, and are
// dragged out from there (the game's destroy prompt is for inventory items).
import { PLAN_ORDER } from "./bank.js";

// Stacks are merged by Compact in the bank itself, so they stay.
const TAKE = PLAN_ORDER.filter(a => a !== "stack");

// result: a bank analysis; bankModel / invModel: what each bank and bag slot holds now.
// Bag slots are numbered from invBase so one move list can cover both windows.
export function planClearOut({ result, bankModel, invModel, invBase, withDestroys }) {
  const wanted = result.slots
    .filter(s => s.kind === "bank" && TAKE.includes(s.action) && (withDestroys || s.action !== "destroy"))
    .map(s => ({ s, index: (s.tab - 1) * 30 + (s.pos - 1) }))
    .filter(({ index }) => bankModel[index])
    .sort((a, b) => TAKE.indexOf(a.s.action) - TAKE.indexOf(b.s.action) || a.index - b.index);
  const free = invModel.map((sig, j) => (sig ? -1 : j)).filter(j => j >= 0);
  const steps = [], destroys = [];
  wanted.forEach(({ s, index }, k) => {
    if (k >= free.length) return;
    const to = invBase + free[k];
    steps.push({ kind: "move", from: index, to, item: s.item, withdraw: s.action });
    if (s.action === "destroy") destroys.push({ kind: "destroy", from: to, item: s.item });
  });
  return { steps: [...steps, ...destroys], left: Math.max(0, wanted.length - free.length) };
}
