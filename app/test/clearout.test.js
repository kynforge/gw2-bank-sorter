import { test } from "node:test";
import assert from "node:assert/strict";
import { planClearOut } from "../src/core/clearout.js";

// A bank analysis in miniature: one slot per action, plus things to leave alone.
const slot = (index, action, id) => ({ kind: "bank", tab: Math.floor(index / 30) + 1, pos: (index % 30) + 1, action, slot: { id }, item: { id, name: `Item ${id}` } });
const result = {
  slots: [
    slot(0, "keep", 1), slot(1, "sell", 2), slot(2, "stack", 3), slot(3, "vendor", 4),
    slot(4, "destroy", 5), slot(5, "deposit", 6), slot(6, "salvage", 7), slot(7, "use", 8),
    { kind: "character", action: "sell", slot: { id: 9 }, item: { id: 9 } },
  ],
};
const bank = ["1|", "2|", "3|", "4|", "5|", "6|", "7|", "8|"];

test("withdraws what the plan deals with into empty bag slots, in plan order", () => {
  const bags = ["9|", null, null, "9|", null, null, null, null];
  const { steps, left } = planClearOut({ result, bankModel: bank, invModel: bags, invBase: 100, withDestroys: false });
  // Deposit, use, vendor, salvage, sell (the plan's order); keep, stack, destroy and bag items stay put.
  assert.deepEqual(steps.map(s => [s.from, s.to]), [[5, 101], [7, 102], [3, 104], [6, 105], [1, 106]]);
  assert.ok(steps.every(s => s.kind === "move"));
  assert.equal(left, 0);
});

test("a full bag stops the list and says how many are left", () => {
  const { steps, left } = planClearOut({ result, bankModel: bank, invModel: [null, null, "9|"], invBase: 100, withDestroys: true });
  assert.equal(steps.length, 2);
  assert.equal(left, 4);
});

test("destroys come out to the bag first, then get dragged out from there", () => {
  const { steps } = planClearOut({ result, bankModel: bank, invModel: Array(8).fill(null), invBase: 100, withDestroys: true });
  const out = steps.findIndex(s => s.from === 4);
  assert.equal(steps[out].kind, "move");
  const destroy = steps.find(s => s.kind === "destroy");
  assert.equal(destroy.from, steps[out].to, "destroyed from the bag slot it was moved to");
  assert.ok(steps.indexOf(destroy) > out);
});
