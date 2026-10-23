import { test } from "node:test";
import assert from "node:assert/strict";
import { similarity, judge } from "../src/core/matcher.js";

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
const rand = rng(7);
// A made-up icon fingerprint: 8×8 RGB with some structure, like a real icon.
const icon = () => Uint8Array.from({ length: 192 }, (_, i) => Math.floor(rand() * 200 + (i % 24 < 12 ? 40 : 0)));
const noisy = (fp, amount = 12) => fp.map(v => Math.max(0, Math.min(255, v + Math.round((rand() - 0.5) * 2 * amount))));
// An empty slot: dark, nearly flat texture.
const EMPTY = Uint8Array.from({ length: 192 }, () => 30 + Math.floor(rand() * 6));

const A = icon(), B = icon(), C = icon();
const candidates = [{ key: "A", fp: A }, { key: "B", fp: B }, { key: "C", fp: C }];

test("similarity is 1 for identical fingerprints and lower for different ones", () => {
  assert.equal(similarity(A, A), 1);
  assert.ok(similarity(A, B) < 0.8);
});

test("judge accepts the expected icon with noise", () => {
  const r = judge(noisy(A), { key: "A", fp: A }, candidates, EMPTY);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.score > 0.85);
});

test("rejects when expected is not best", () => {
  const r = judge(noisy(B), { key: "A", fp: A }, candidates, EMPTY);
  assert.equal(r.ok, false);
  assert.equal(r.best.key, "B");
  assert.match(r.reason, /looks more like B/);
});

test("empty slot detection", () => {
  assert.equal(judge(noisy(EMPTY, 3), "empty", candidates, EMPTY).ok, true);
  assert.equal(judge(noisy(EMPTY, 3), { key: "A", fp: A }, candidates, EMPTY).ok, false);
  assert.equal(judge(noisy(A), "empty", candidates, EMPTY).ok, false);
  // Without a learned empty slot there's nothing to compare against, so it refuses rather than guesses.
  const unknown = judge(noisy(EMPTY, 3), "empty", candidates, null);
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /Verify/);
});
