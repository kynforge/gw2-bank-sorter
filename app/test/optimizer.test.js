import { test } from "node:test";
import assert from "node:assert/strict";
import { optimize, score, GOALS } from "../src/core/optimizer.js";
import { BASE, DEFAULT_ASSUMPTIONS, derived } from "../src/core/stats.js";

const stat = (id, name, attrs) => ({ id, name, attributes: attrs.map(([attribute, multiplier, value = 0]) => ({ attribute, multiplier, value })) });
const BERSERKER = stat(161, "Berserker's", [["Power", 0.35], ["Precision", 0.25], ["CritDamage", 0.25]]);
const ASSASSIN = stat(753, "Assassin's", [["Power", 0.25], ["Precision", 0.35], ["CritDamage", 0.25]]);
const DIVINER = stat(1538, "Diviner's", [["Power", 0.3, 25], ["Precision", 0.165, 12], ["CritDamage", 0.165, 12], ["BoonDuration", 0.3, 25]]);
const noBuffs = { ...DEFAULT_ASSUMPTIONS, might: 0, fury: 0 };
const twoSlots = choices => [{ slot: "Ring1", adj: 500, choices }, { slot: "Ring2", adj: 500, choices }];

test("optimizer prefers precision when under the cap", () => {
  const lowCrit = optimize({ slots: twoSlots([BERSERKER, ASSASSIN]), base: { ...BASE, Power: 3000, CritDamage: 1000 }, goal: "power", assumptions: noBuffs });
  assert.deepEqual(lowCrit.picks, { Ring1: 753, Ring2: 753 });
  const capped = optimize({ slots: twoSlots([BERSERKER, ASSASSIN]), base: { ...BASE, Power: 3000, Precision: 3500, CritDamage: 1000 }, goal: "power", assumptions: noBuffs });
  assert.deepEqual(capped.picks, { Ring1: 161, Ring2: 161 });
});

test("boonDps respects minimum boon duration", () => {
  const free = optimize({ slots: twoSlots([BERSERKER, DIVINER]), base: { ...BASE }, goal: "boonDps", opts: { minBoon: 0 }, assumptions: noBuffs });
  assert.deepEqual(free.picks, { Ring1: 161, Ring2: 161 });
  // 20% boon duration needs 300 Concentration: only two Diviner's pieces (175 each) get there.
  const needed = optimize({ slots: twoSlots([BERSERKER, DIVINER]), base: { ...BASE }, goal: "boonDps", opts: { minBoon: 20 }, assumptions: noBuffs });
  assert.deepEqual(needed.picks, { Ring1: 1538, Ring2: 1538 });
  assert.ok(needed.derived.boonDuration >= 20);
});

test("the result's score matches its own stats", () => {
  const r = optimize({ slots: twoSlots([BERSERKER, ASSASSIN]), base: { ...BASE }, goal: "power", assumptions: DEFAULT_ASSUMPTIONS });
  assert.equal(r.score, score(derived(r.attrs, DEFAULT_ASSUMPTIONS), "power"));
  assert.deepEqual(GOALS.map(g => g.id), ["power", "condi", "hybrid", "boonDps", "healer"]);
});

test("an unreachable boon target still returns the closest set", () => {
  const r = optimize({ slots: twoSlots([BERSERKER, DIVINER]), base: { ...BASE }, goal: "boonDps", opts: { minBoon: 90 }, assumptions: noBuffs });
  assert.deepEqual(r.picks, { Ring1: 1538, Ring2: 1538 });
  assert.equal(r.unmet, true);
});

test("condition goal prefers Viper's over Trailblazer's", () => {
  const VIPER = stat(1130, "Viper's", [["Power", 0.3], ["Precision", 0.165], ["ConditionDamage", 0.3], ["ConditionDuration", 0.165]]);
  const TRAILBLAZER = stat(1085, "Trailblazer's", [["Toughness", 0.3], ["Vitality", 0.165], ["ConditionDamage", 0.3], ["ConditionDuration", 0.165]]);
  const r = optimize({ slots: twoSlots([TRAILBLAZER, VIPER]), base: { ...BASE }, goal: "condi", opts: { condition: "burning" }, assumptions: DEFAULT_ASSUMPTIONS });
  assert.deepEqual(r.picks, { Ring1: 1130, Ring2: 1130 });
});
