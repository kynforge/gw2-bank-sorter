import { test } from "node:test";
import assert from "node:assert/strict";
import { pitchFrom, slotCenter, slotSize, averageFingerprints } from "../src/core/calibration.js";

const calib = { pitch: 40, cols: 10, tabs: { 1: [100, 200], 2: [100, 400] } };

test("pitch comes from the first and last slot of a row", () => {
  assert.equal(pitchFrom([100, 200], [460, 202], 10), 40);
  assert.throws(() => pitchFrom([100, 200], [460, 300], 10), /same row/);
  assert.throws(() => pitchFrom([100, 200], [460, 200], 1), /slots per row/);
  assert.throws(() => pitchFrom([460, 200], [100, 200], 10), /right of the first/);
});

test("slot centres follow rows and tabs", () => {
  assert.deepEqual(slotCenter(calib, 0), [100, 200]);
  assert.deepEqual(slotCenter(calib, 11), [140, 240]);
  assert.deepEqual(slotCenter(calib, 35), [300, 400], "tab 2, slot 6");
  assert.equal(slotCenter(calib, 65), null, "tab 3 isn't calibrated");
  assert.equal(slotSize(calib), 35);
});

test("averaging fingerprints", () => {
  assert.deepEqual([...averageFingerprints([[0, 10], [10, 30]])], [5, 20]);
  assert.equal(averageFingerprints([]), null);
});

test("saved calibration keeps both empty-slot fingerprints as arrays", async () => {
  const { saveCalibration, loadCalibration } = await import("../src/core/calibration.js");
  const mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  saveCalibration("k", { pitch: 40, cols: 10, tabs: { 1: [1, 2] }, emptyFp: Uint8Array.from([1, 2]), inv: { cols: 8, emptyFp: Uint8Array.from([3, 4]) } });
  const back = loadCalibration("k");
  delete globalThis.localStorage;
  assert.deepEqual(back.emptyFp, [1, 2]);
  assert.deepEqual(back.inv.emptyFp, [3, 4]);
});
