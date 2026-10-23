import { test } from "node:test";
import assert from "node:assert/strict";
import { planArrangement, planMoves, applyMove, signature, unplacedCount } from "../src/core/arrange.js";

// A small seeded random generator, so failures repeat.
function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
const shuffle = (arr, rand) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const idOf = sig => sig?.split("|")[0] ?? null;
function run(current, moves) {
  const arr = [...current];
  for (const m of moves) {
    assert.notEqual(idOf(arr[m.to]), idOf(arr[m.from]), `move ${m.from}→${m.to} would drop an item onto the same item`);
    applyMove(arr, m);
  }
  return arr;
}

test("planMoves reaches target", () => {
  const rand = rng(42);
  for (let round = 0; round < 200; round++) {
    const target = Array.from({ length: 30 }, () => (rand() < 0.3 ? null : `${100 + Math.floor(rand() * 12)}|`));
    const current = shuffle(target, rand);
    const moves = planMoves(current, target);
    assert.deepEqual(run(current, moves), target);
    const misplaced = current.filter((s, i) => s !== target[i]).length;
    assert.ok(moves.length <= misplaced, `${moves.length} moves for ${misplaced} misplaced slots`);
  }
});

test("planMoves reaches target when bound and unbound copies mix", () => {
  const rand = rng(99);
  for (let round = 0; round < 200; round++) {
    const target = Array.from({ length: 30 }, () => (rand() < 0.2 ? null : `${100 + Math.floor(rand() * 6)}|${rand() < 0.4 ? "Account" : ""}`));
    const current = shuffle(target, rand);
    const moves = planMoves(current, target);
    assert.deepEqual(run(current, moves), target);
    const misplaced = current.filter((s, i) => s !== target[i]).length;
    assert.ok(moves.length <= 2 * misplaced, `${moves.length} moves for ${misplaced} misplaced slots`);
  }
});

test("identical ids are interchangeable", () => {
  const current = ["19721|", "24277|", "19721|"];
  assert.deepEqual(planMoves(current, ["19721|", "24277|", "19721|"]), []);
  assert.equal(planMoves(["24277|", "19721|", null], ["19721|", "24277|", null]).length, 1, "a swap fixes both");
});

test("never drops onto same id", () => {
  // The same item with and without account binding must not be dropped onto each other: that could merge them.
  const current = ["5|Account", "5|", null, "7|"];
  const target = ["5|", "7|", "5|Account", null];
  const moves = planMoves(current, target);
  assert.deepEqual(run(current, moves), target);
});

test("planArrangement groups by category without merging stacks", () => {
  const items = new Map([
    [1, { id: 1, name: "Sword", type: "Weapon", rarity: "Rare", level: 80, details: { type: "Sword" } }],
    [2, { id: 2, name: "Mithril Ore", type: "CraftingMaterial", rarity: "Basic" }],
    [3, { id: 3, name: "Rune", type: "UpgradeComponent", rarity: "Exotic", details: { type: "Rune" } }],
  ]);
  const bank = [{ id: 2, count: 10 }, null, { id: 1, count: 1 }, { id: 2, count: 5 }, { id: 3, count: 1 }, ...Array(25).fill(null)];
  const target = planArrangement(bank, items, new Map(), 1);
  assert.deepEqual(target.slice(0, 5), [signature(bank[2]), signature(bank[4]), signature(bank[0]), signature(bank[3]), null]);
  assert.equal(target.length, 30);
  assert.equal(target.filter(Boolean).length, 4, "both Mithril stacks stay separate");
});

test("planMoves finishes packed banks with mixed bindings", () => {
  const rand = rng(2024);
  let short = 0;
  for (let round = 0; round < 1000; round++) {
    const target = Array.from({ length: 12 }, () => `${1 + Math.floor(rand() * 3)}|${["", "A", "B"][Math.floor(rand() * 3)]}`);
    const current = shuffle(target, rand);
    const moves = planMoves(current, target);
    const end = run(current, moves);
    // With no empty slot some layouts can't be reached without merging; then the leftovers must be reported.
    const left = end.filter((s, i) => s !== target[i]).length;
    assert.equal(unplacedCount(current, target, moves), left);
    if (left) short++;
  }
  assert.equal(short, 0, `${short} packed banks stopped short`);
  const cur = ["2|", "2|A", "3|A", "1|", "2|A", "2|A", "3|"];
  const target = ["2|A", "3|", "1|", "2|A", "3|A", "2|A", "2|"];
  assert.deepEqual(run(cur, planMoves(cur, target)), target, "the reviewer's packed case");
});

test("an unreachable layout is reported, not claimed", () => {
  // The same item bound and unbound, and no free slot: swapping them would merge the stacks.
  const current = ["5|Account", "5|"];
  const target = ["5|", "5|Account"];
  const moves = planMoves(current, target);
  assert.deepEqual(moves, []);
  assert.equal(unplacedCount(current, target, moves), 2);
});
