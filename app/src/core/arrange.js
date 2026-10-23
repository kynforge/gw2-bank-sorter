// The bank macro's move list: where every stack should go, and the drags that get it there.
// In game, dropping an item onto another item swaps them, and dropping it onto the same item merges
// the stacks. Merges change counts in ways the plan can't follow, so a move never drops an item onto
// another copy of the same item.
import { TAB_SIZE } from "./account.js";
import { CATEGORY_ORDER, categoryOf, compareEntries, packTabs } from "./bank.js";

// What makes two stacks interchangeable for arranging: the item, and how it's bound.
export const signature = slot => slot ? `${slot.id}|${slot.binding || ""}${slot.bound_to ? `|${slot.bound_to}` : ""}` : null;
const idOf = sig => sig ? sig.split("|")[0] : null;

// The same tab groups as the suggested layout, using the stacks as they are now (Compact merges them).
export function planArrangement(bank, items, storable, tabCount = Math.max(1, Math.ceil(bank.length / TAB_SIZE))) {
  const entries = bank.filter(Boolean).map(slot => ({ slot, item: items.get(slot.id), cat: categoryOf(items.get(slot.id), storable) }));
  const cats = CATEGORY_ORDER
    .map(id => ({ id, entries: entries.filter(e => e.cat === id).sort((a, b) => compareEntries(a, b, storable)) }))
    .filter(c => c.entries.length);
  const tabs = packTabs(cats, tabCount);
  const target = new Array(bank.length).fill(null);
  tabs.forEach((tab, t) => tab.entries.forEach((e, i) => { if (t * TAB_SIZE + i < target.length) target[t * TAB_SIZE + i] = signature(e.slot); }));
  return target;
}

export function applyMove(arr, { from, to }) {
  [arr[from], arr[to]] = [arr[to], arr[from]];
  return arr;
}

// Greedy: fill each position with the stack that belongs there, preferring a swap that also puts the
// displaced stack where it belongs.
export function planMoves(current, target) {
  const cur = [...current];
  const moves = [];
  const move = (from, to) => { moves.push({ from, to }); applyMove(cur, { from, to }); };
  const settled = i => cur[i] === target[i];

  // In a full bank, moving a same-item stack aside can unsettle an earlier slot, so passes repeat
  // until one changes nothing.
  for (let pass = 0; pass < cur.length; pass++) {
    const before = moves.length;
    greedyPass(cur, target, settled, move);
    if (moves.length === before) break;
  }
  return moves;
}

// How many slots still won't hold their planned stack after the moves: reported, never hidden.
export function unplacedCount(current, target, moves) {
  const end = [...current];
  for (const m of moves) applyMove(end, m);
  return end.filter((s, i) => s !== target[i]).length;
}

function greedyPass(cur, target, settled, move) {
  for (let p = 0; p < cur.length; p++) {
    if (settled(p) || target[p] === null) continue;
    const want = target[p];
    let q = -1;
    for (let i = 0; i < cur.length; i++) {
      if (i === p || cur[i] !== want || settled(i)) continue;
      if (q < 0) q = i;
      if (target[i] === cur[p]) { q = i; break; }
    }
    if (q < 0) continue;   // the target names a stack that isn't here; leave the slot alone

    // Dropping onto another copy of the same item would merge them, so move that copy out of the way first.
    if (cur[p] !== null && idOf(cur[p]) === idOf(want)) {
      const empties = cur.map((s, i) => (s === null && i !== p ? i : -1)).filter(i => i >= 0);
      const home = empties.find(i => target[i] === cur[p]) ?? empties.find(i => target[i] === null) ?? empties[0];
      // With no empty slot, swap it with any stack of a different item (which then moves on later).
      const aside = home ?? cur.findIndex((s, i) => i !== p && i !== q && s !== null && idOf(s) !== idOf(want));
      if (aside == null || aside < 0) continue;
      move(p, aside);
    }
    move(q, p);
  }
}
