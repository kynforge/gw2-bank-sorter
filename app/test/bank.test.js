import { test } from "node:test";
import assert from "node:assert/strict";
import { setFetch } from "../src/core/api.js";
import { loadExample } from "../src/core/account.js";
import { analyze } from "../src/core/bank.js";
import { recipeUses, recipeCount } from "../src/core/recipes.js";
import { replayFetch, fakeFetch } from "./helpers.js";

const noPrefs = () => ({ keep: new Map(), done: new Set(), ignore: new Map() });
const bankSlot = (result, index) => result.slots.find(s => s.kind === "bank" && s.tab === Math.floor(index / 30) + 1 && s.pos === (index % 30) + 1);

async function example() {
  setFetch(replayFetch());
  return loadExample();
}

test("example plan classifies known items", async () => {
  const r = analyze(await example(), noPrefs());
  assert.equal(bankSlot(r, 2).slot.id, 19721);
  assert.equal(bankSlot(r, 2).action, "deposit", "Glob of Ectoplasm fits in Material Storage");
  assert.ok(["sell", "destroy"].includes(bankSlot(r, 9).action), "the Abyss Dye is already unlocked");
  // Superior Sharpening Stone at tab 1 slot 24 (40) and tab 3 slot 6 (25): the smaller stack merges.
  assert.equal(bankSlot(r, 23).action, "keep");
  assert.equal(bankSlot(r, 65).action, "stack");
  const laces = bankSlot(r, 26);
  assert.equal(laces.slot.id, 67807);
  assert.equal(laces.action, "keep");
  assert.ok(laces.forCollections?.length, "Luminescent Laces are kept for a collection");
});

test("destroy becomes keep when used in a recipe", async () => {
  const account = await example();
  const before = analyze(account, noPrefs());
  const target = before.slots.find(s => s.action === "destroy");
  assert.ok(target, "the example has something to destroy");
  const after = analyze(account, noPrefs(), { recipeUses: new Map([[target.slot.id, ["Some Output"]]]) });
  const same = after.slots[target.index];
  assert.equal(same.action, "keep");
  assert.match(same.reason, /Some Output/);
});

test("always-keep items are never sold, used or destroyed", async () => {
  const account = await example();
  const prefs = noPrefs();
  prefs.keep.set(20356, { name: "Abyss Dye", icon: "" });
  assert.equal(bankSlot(analyze(account, prefs), 9).action, "keep");
});

test("recipeUses returns output names per ingredient", async () => {
  setFetch(fakeFetch({
    "/recipes/search": u => (u.searchParams.get("input") === "5" ? [1, 2] : []),
    "/recipes": [{ id: 1, output_item_id: 100 }, { id: 2, output_item_id: 101 }],
    "/items": [{ id: 100, name: "Alpha" }, { id: 101, name: "Beta" }],
  }));
  const uses = await recipeUses([5, 6]);
  assert.deepEqual(uses.get(5), ["Alpha", "Beta"]);
  assert.deepEqual(uses.get(6), []);
});

test("recipeUses names a sample but counts every recipe", async () => {
  const ids = Array.from({ length: 30 }, (_, i) => 1000 + i);
  setFetch(fakeFetch({
    "/recipes/search": ids,
    "/recipes": u => u.searchParams.get("ids").split(",").map(id => ({ id: +id, output_item_id: +id + 5000 })),
    "/items": u => u.searchParams.get("ids").split(",").map(id => ({ id: +id, name: `Output ${id}` })),
  }));
  const names = (await recipeUses([77])).get(77);
  assert.equal(names.length, 20);
  assert.equal(recipeCount(77), 30);
});
