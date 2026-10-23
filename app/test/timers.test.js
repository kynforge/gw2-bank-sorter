import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { occurrences, WORLD_BOSS_API_IDS, MAPCHEST_EVENT_IDS } from "../src/core/timers.js";
import { nextDailyReset, nextWeeklyReset, formatCountdown } from "../src/core/daily.js";

const data = JSON.parse(readFileSync(new URL("../src/data/event-timers.json", import.meta.url), "utf8"));
const at = iso => Date.parse(iso);
const startsOf = (list, name) => list.filter(o => o.name === name).map(o => new Date(o.start).toISOString().slice(11, 16));

test("world bosses at known times", () => {
  const day = occurrences(data, at("2026-10-23T00:00:00Z"), at("2026-10-24T00:00:00Z"));
  assert.deepEqual(startsOf(day, "The Shatterer"), ["01:00", "04:00", "07:00", "10:00", "13:00", "16:00", "19:00", "22:00"]);
  assert.ok(startsOf(day, "Tequatl the Sunless").includes("11:30"));
  const shatterer = day.find(o => o.name === "The Shatterer");
  assert.equal(shatterer.chatlink, "[&BE4DAAA=]");
  assert.equal(shatterer.category, "Core Tyria");
  assert.equal(shatterer.end - shatterer.start, 15 * 60_000);
});

test("crosses midnight", () => {
  const list = occurrences(data, at("2026-10-23T23:30:00Z"), at("2026-10-24T00:45:00Z"));
  const admiral = list.find(o => o.name === "Admiral Taidha Covington");
  assert.equal(new Date(admiral.start).toISOString(), "2026-10-24T00:00:00.000Z");
  // Shadow Behemoth at 23:45 belongs to the evening before.
  assert.ok(list.some(o => o.name === "Shadow Behemoth" && new Date(o.start).toISOString() === "2026-10-23T23:45:00.000Z"));
});

test("only named segments are returned, each once", () => {
  const list = occurrences(data, at("2026-10-23T10:00:00Z"), at("2026-10-23T12:00:00Z"));
  assert.ok(list.every(o => o.name));
  assert.equal(new Set(list.map(o => o.key)).size, list.length);
});

test("weekly reset is Monday 07:30 UTC", () => {
  assert.equal(new Date(nextWeeklyReset(at("2026-10-23T12:00:00Z"))).toISOString(), "2026-10-26T07:30:00.000Z");
  assert.equal(new Date(nextWeeklyReset(at("2026-10-26T07:29:00Z"))).toISOString(), "2026-10-26T07:30:00.000Z");
  assert.equal(new Date(nextWeeklyReset(at("2026-10-26T07:30:00Z"))).toISOString(), "2026-11-02T07:30:00.000Z");
  assert.equal(new Date(nextDailyReset(at("2026-10-23T12:00:00Z"))).toISOString(), "2026-10-24T00:00:00.000Z");
});

test("countdowns read naturally", () => {
  assert.equal(formatCountdown(3_723_000), "1h 2m");
  assert.equal(formatCountdown(125_000), "2m 5s");
  assert.equal(formatCountdown(9_000), "9s");
  assert.equal(formatCountdown(-1), "now");
  assert.equal(formatCountdown(2 * 86_400_000 + 3 * 3_600_000 + 5_000), "2d 3h");
});

test("every scheduled world boss maps to an API id", () => {
  const day = occurrences(data, at("2026-10-23T00:00:00Z"), at("2026-10-24T00:00:00Z"));
  const bossNames = new Set(day.filter(o => o.eventId === "core-wb" || o.eventId === "core-hwb").map(o => o.name));
  for (const name of bossNames) assert.ok(WORLD_BOSS_API_IDS[name], `${name} has an API id`);
  assert.equal(MAPCHEST_EVENT_IDS["hot-ab"], "auric_basin_heros_choice_chest");
});
