import { test } from "node:test";
import assert from "node:assert/strict";
import { setFetch } from "../src/core/api.js";
import { loadExample } from "../src/core/account.js";
import { itemStat, gearAttributes, derived, DEFAULT_ASSUMPTIONS, BASE } from "../src/core/stats.js";
import { parseEliteInsights } from "../src/core/eilog.js";
import { replayFetch, loadFixture } from "./helpers.js";

const fixture = loadFixture();
const itemstats = new Map(Object.entries(fixture).find(([u]) => u.includes("/itemstats?"))[1].body.map(s => [s.id, s]));
const noBuffs = { ...DEFAULT_ASSUMPTIONS, might: 0, fury: 0 };

async function warrior() {
  setFetch(replayFetch());
  const account = await loadExample();
  return { account, equipment: account.characters.find(c => c.name === "Example Warrior").equipment };
}

test("itemStat matches in-game", () => {
  assert.deepEqual(itemStat(717.024, itemstats.get(161)), { Power: 251, Precision: 179, CritDamage: 179 });
  assert.deepEqual(itemStat(358.512, itemstats.get(584)), { Power: 157, Precision: 108, CritDamage: 108 });
});

test("crit chance formula", () => {
  assert.ok(Math.abs(derived({ ...BASE, Precision: 2000 }, noBuffs).critChance - 52.62) < 0.01);
  assert.equal(derived({ ...BASE, Precision: 4000 }, noBuffs).critChance, 100);
  assert.equal(derived({ ...BASE, CritDamage: 1500 }, noBuffs).critDamage, 250);
});

test("might and fury come from the assumptions", () => {
  const d = derived({ ...BASE }, { ...DEFAULT_ASSUMPTIONS, might: 25, fury: 1, furyCrit: 25 });
  assert.equal(d.power, 1750);
  assert.equal(d.condiDamage, 750);
  assert.equal(d.critChance, 30);
});

test("gear, runes and stat choices add up", async () => {
  const { account, equipment } = await warrior();
  const g = gearAttributes(equipment, { items: account.items, itemstats });
  assert.deepEqual(g.missing, []);
  // Six Superior Runes of the Scholar: +175 Power and +225 Ferocity.
  const runes = g.sources.find(s => s.label === "Superior Rune of the Scholar");
  assert.deepEqual(runes.attrs, { Power: 175, CritDamage: 225 });
  // Berserker's legendary greatsword in weapon set 1.
  assert.deepEqual(g.sources.find(s => s.slot === "WeaponA1").attrs, { Power: 251, Precision: 179, CritDamage: 179 });
  // Weapon set 2 doesn't count while set 1 is active.
  assert.ok(!g.sources.some(s => s.slot === "WeaponB1"));
});

test("missing slots are reported", async () => {
  const { account, equipment } = await warrior();
  const g = gearAttributes(equipment.filter(e => e.slot !== "Ring2"), { items: account.items, itemstats });
  assert.deepEqual(g.missing, ["Ring2"]);
});

test("parseEliteInsights reads might and fury", () => {
  const log = {
    recordedBy: "Ana",
    players: [
      { name: "Bo", buffUptimes: [{ id: 740, buffData: [{ uptime: 10 }] }] },
      { name: "Ana", buffUptimes: [{ id: 740, buffData: [{ uptime: 22.5 }] }, { id: 725, buffData: [{ uptime: 87 }] }] },
    ],
  };
  const r = parseEliteInsights(log);
  assert.equal(r.name, "Ana");
  assert.equal(r.might, 22.5);
  assert.equal(r.fury, 0.87);
  assert.deepEqual(r.players, ["Bo", "Ana"]);
  assert.equal(parseEliteInsights(log, "Bo").might, 10);
  assert.throws(() => parseEliteInsights({ nothing: true }), /Elite Insights/);
});
