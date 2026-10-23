import { test } from "node:test";
import assert from "node:assert/strict";
import { setFetch } from "../src/core/api.js";
import { loadExample, buildContainers } from "../src/core/account.js";
import { buildIndex, search, scattered } from "../src/core/finder.js";
import { replayFetch } from "./helpers.js";

// A small hand-made account: items by id, characters with one bag each.
function mkAccount({ items, chars = [], bank = [], storage = {} }) {
  const characters = chars.map(([name, ids]) => ({ name, bags: [{ id: 1, size: ids.length, inventory: ids.map(id => ({ id, count: 1 })) }] }));
  return {
    items: new Map(Object.entries(items).map(([id, name]) => [+id, { id: +id, name, rarity: "Basic", type: "Trophy" }])),
    containers: buildContainers(bank, [], characters),
    storage: new Map(Object.entries(storage).map(([k, v]) => [+k, v])),
    characters: characters.map(c => ({ name: c.name, equipment: [] })),
    legendary: new Map(), prices: new Map(),
  };
}

test("search is case and accent insensitive", async () => {
  setFetch(replayFetch());
  const index = buildIndex(await loadExample());
  const [first] = search(index, "ECTO");
  assert.equal(first.item.name, "Glob of Ectoplasm");
  // 87 in the bank, 13 on the warrior and 400 in Material Storage.
  assert.equal(first.total, 500);
  assert.ok(first.places.some(p => p.kind === "storage" && p.count === 400));

  const accents = buildIndex(mkAccount({ items: { 1: "Pétale de Rose" }, bank: [{ id: 1, count: 2 }] }));
  assert.equal(search(accents, "petale")[0]?.item.id, 1);
});

test("word-start beats substring", () => {
  const index = buildIndex(mkAccount({
    items: { 1: "Spore Sample", 2: "Mithril Ore", 3: "Ore Chunk" },
    bank: [{ id: 1, count: 50 }, { id: 2, count: 5 }, { id: 3, count: 1 }],
  }));
  const names = search(index, "ore").map(e => e.item.name);
  assert.deepEqual(names, ["Mithril Ore", "Ore Chunk", "Spore Sample"]);
});

test("scattered lists items on 3+ characters", () => {
  const index = buildIndex(mkAccount({
    items: { 5: "Fractal Incursion Token", 6: "Lone Trophy" },
    chars: [["Ana", [5, 6]], ["Bo", [5]], ["Cy", [5, 5]]],
  }));
  const list = scattered(index);
  assert.equal(list.length, 1);
  assert.equal(list[0].item.id, 5);
  assert.equal(list[0].characters, 3);
  assert.equal(list[0].total, 4);
});

test("an empty query finds nothing", async () => {
  setFetch(replayFetch());
  assert.deepEqual(search(buildIndex(await loadExample()), "  "), []);
});

test("gear listed without a slot doesn't break the search", () => {
  const account = mkAccount({ items: { 9: "Aurora" } });
  account.characters = [{ name: "Ana", equipment: [{ id: 9, location: "LegendaryArmory" }] }];
  const [hit] = search(buildIndex(account), "aurora");
  assert.equal(hit.total, 1);
  assert.match(hit.places[0].where, /Ana/);
});
