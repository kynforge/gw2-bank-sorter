import { test } from "node:test";
import assert from "node:assert/strict";
import { setFetch, UserError } from "../src/core/api.js";
import { loadExample, loadAccount, whereText } from "../src/core/account.js";
import { replayFetch } from "./helpers.js";

test("loadExample builds containers", async () => {
  setFetch(replayFetch());
  const a = await loadExample();
  assert.equal(a.bank.length, 120);
  assert.ok(a.containers.length >= 3, "bank, shared slots and characters");
  const bank = a.containers.find(c => c.kind === "bank");
  assert.equal(whereText(bank, bank.cells[31]), "Tab 2, slot 2");
  assert.match(a.items.get(19721).name, /Ectoplasm/);
  // Equipment items and their upgrades are in the catalog, so the Builds panel can use them.
  const warrior = a.characters.find(c => c.name === "Example Warrior");
  assert.ok(warrior.equipment.length >= 14);
  assert.ok(a.items.has(warrior.equipment[0].id));
  assert.ok(a.items.has(24836), "Superior Rune of the Scholar");
});

test("401 keeps previous data", async () => {
  setFetch(async () => new Response(JSON.stringify({ text: "Invalid access token" }), { status: 401 }));
  await assert.rejects(loadAccount("BAD-KEY"), err => err instanceof UserError && /didn't accept this API key/.test(err.message));
});

test("a key without account and inventories is refused with a reason", async () => {
  setFetch(async () => new Response(JSON.stringify({ permissions: ["account"] }), { status: 200 }));
  await assert.rejects(loadAccount("KEY"), err => err instanceof UserError && /missing the inventories permission/.test(err.message));
});

test("without an active equipment tab, only equipped gear counts", async () => {
  const { characterInfo } = await import("../src/core/account.js");
  const info = characterInfo({ name: "Ana", profession: "Thief", equipment: [
    { id: 1, slot: "Helm", location: "Equipped" },
    { id: 2, slot: "Helm", location: "Armory" },
    { id: 3, location: "LegendaryArmory" },
    { id: 4, slot: "Coat", location: "EquippedFromLegendaryArmory" },
  ] });
  assert.deepEqual(info.equipment.map(e => e.id), [1, 4]);
});
