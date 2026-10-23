import { test } from "node:test";
import assert from "node:assert/strict";
import { findGrid } from "../src/core/findgrid.js";

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

// A made-up screen: bank tabs drawn as a grid of item icons, with headers between tabs.
function fakeScreen({ origin, pitch, cols, headerGap, firstTab, lastVisibleTab, fill = 0.7, seed = 1, emptyFirstRowOf = null }) {
  const rand = rng(seed);
  const icon = () => Uint8Array.from({ length: 192 }, (_, i) => Math.floor(rand() * 200 + (i % 24 < 12 ? 40 : 0)));
  const EMPTY = Uint8Array.from({ length: 192 }, () => 28 + Math.floor(rand() * 5));
  const icons = new Map();
  const bank = Array.from({ length: 4 * 30 }, (_, i) => {
    const tab = Math.floor(i / 30) + 1, pos = i % 30;
    if (tab === emptyFirstRowOf && pos < cols) return null;
    if (rand() > fill) return null;
    const id = 1 + Math.floor(rand() * 40);
    if (!icons.has(id)) icons.set(id, icon());
    return id;
  });
  const rows = Math.ceil(30 / cols);
  const tabY = {};
  let y = origin[1];
  for (let t = firstTab; t <= lastVisibleTab; t++) { tabY[t] = y; y += rows * pitch + headerGap; }
  const slotSize = pitch * 0.88;
  const noise = () => Math.round((rand() - 0.5) * 16);
  const sample = async rects => rects.map(([cx, cy, size]) => {
    for (const [t, ty] of Object.entries(tabY)) {
      for (let pos = 0; pos < 30; pos++) {
        const sx = origin[0] + (pos % cols) * pitch, sy = ty + Math.floor(pos / cols) * pitch;
        const off = Math.hypot(cx - sx, cy - sy);
        if (off > pitch * 0.2 || Math.abs(size - slotSize) > slotSize * 0.2) continue;
        const id = bank[(+t - 1) * 30 + pos];
        const fp = id ? icons.get(id) : EMPTY;
        // Off-centre captures blur toward the slot background.
        const w = Math.max(0, 1 - off / (pitch * 0.2));
        return fp.map(v => Math.max(0, Math.min(255, Math.round(v * w + 30 * (1 - w)) + noise())));
      }
    }
    return Uint8Array.from({ length: 192 }, () => Math.floor(rand() * 255));
  });
  const expected = i => (bank[i] ? { fp: icons.get(bank[i]) } : "empty");
  return { sample, expected, tabY };
}

test("finds spacing, row width and the visible tabs from one point", async () => {
  const screen = fakeScreen({ origin: [503, 297], pitch: 47.5, cols: 8, headerGap: 37, firstTab: 2, lastVisibleTab: 3 });
  const g = await findGrid({ origin: [507, 293], sample: screen.sample, expected: screen.expected, tabCount: 4, bottom: 1080 });
  assert.equal(g.ok, true, g.reason);
  assert.ok(Math.abs(g.pitch - 47.5) <= 0.5, `pitch ${g.pitch}`);
  assert.equal(g.cols, 8);
  assert.deepEqual(Object.keys(g.tabs).map(Number), [2, 3]);
  assert.ok(Math.abs(g.tabs[2][0] - 503) <= 2 && Math.abs(g.tabs[2][1] - 297) <= 2, `tab 2 at ${g.tabs[2]}`);
  assert.ok(Math.abs(g.tabs[3][1] - screen.tabY[3]) <= 2, `tab 3 at ${g.tabs[3]}, expected y ${screen.tabY[3]}`);
  assert.ok(g.matched / g.checked > 0.95, `${g.matched} of ${g.checked} matched`);
});

test("a tab with an empty first row is found by its other rows", async () => {
  const screen = fakeScreen({ origin: [300, 200], pitch: 60, cols: 10, headerGap: 45, firstTab: 1, lastVisibleTab: 3, emptyFirstRowOf: 2, seed: 9 });
  const g = await findGrid({ origin: [300, 200], sample: screen.sample, expected: screen.expected, tabCount: 4, bottom: 1600 });
  assert.equal(g.ok, true, g.reason);
  assert.equal(g.cols, 10);
  assert.deepEqual(Object.keys(g.tabs).map(Number), [1, 2, 3]);
  assert.ok(Math.abs(g.tabs[2][1] - screen.tabY[2]) <= 2);
});

test("says so when the point isn't on the bank", async () => {
  const rand = rng(3);
  const sample = async rects => rects.map(() => Uint8Array.from({ length: 192 }, () => Math.floor(rand() * 255)));
  const screen = fakeScreen({ origin: [300, 200], pitch: 50, cols: 10, headerGap: 40, firstTab: 1, lastVisibleTab: 1 });
  const g = await findGrid({ origin: [300, 200], sample, expected: screen.expected, tabCount: 4, bottom: 1080 });
  assert.equal(g.ok, false);
  assert.match(g.reason, /first slot/);
});

/* ---------- Bags and scrolling ---------- */

import { findInventory, relocate } from "../src/core/findgrid.js";

// Draws any list of sections (each { id, size, y, ids: item id or null per slot }) as a grid at x0.
function drawSections({ x0, pitch, sections, iconOf, seed = 5, emptyFp }) {
  const rand = rng(seed);
  const slotSize = pitch * 0.88;
  return async rects => rects.map(([cx, cy, size]) => {
    for (const s of sections) {
      for (let pos = 0; pos < s.size; pos++) {
        const sx = x0 + (pos % s.cols) * pitch, sy = s.y + Math.floor(pos / s.cols) * pitch;
        const off = Math.hypot(cx - sx, cy - sy);
        if (off > pitch * 0.2 || Math.abs(size - slotSize) > slotSize * 0.2) continue;
        const fp = s.ids[pos] ? iconOf(s.ids[pos]) : emptyFp;
        const w = Math.max(0, 1 - off / (pitch * 0.2));
        return fp.map(v => Math.max(0, Math.min(255, Math.round(v * w + 30 * (1 - w)) + Math.round((rand() - 0.5) * 16))));
      }
    }
    return Uint8Array.from({ length: 192 }, () => Math.floor(rand() * 255));
  });
}
function iconSet(seed) {
  const rand = rng(seed);
  const icons = new Map();
  return id => {
    if (!icons.has(id)) icons.set(id, Uint8Array.from({ length: 192 }, (_, i) => Math.floor(rand() * 200 + (i % 24 < 12 ? 40 : 0))));
    return icons.get(id);
  };
}
const EMPTY_FP = Uint8Array.from({ length: 192 }, (_, i) => 28 + (i % 5));
const bagOf = (size, seed) => { const r = rng(seed); return { id: 8932, size, inventory: Array.from({ length: size }, () => (r() < 0.6 ? { id: 1 + Math.floor(r() * 30), count: 1 } : null)) }; };

test("finds the bags and which character they belong to", async () => {
  const iconOf = iconSet(11);
  const ana = { name: "Ana", bags: [bagOf(20, 1), bagOf(18, 2)] };
  const bo = { name: "Bo", bags: [bagOf(20, 3), null, bagOf(20, 4)] };
  // On screen: Bo's two bags, 5 slots per row, with a header gap between bags.
  const pitch = 52, x0 = 1400, cols = 5;
  const y1 = 600, y2 = y1 + 4 * pitch + 30;
  const sample = drawSections({ x0, pitch, iconOf, emptyFp: EMPTY_FP, sections: [
    { size: 20, cols, y: y1, ids: bo.bags[0].inventory.map(s => s?.id) },
    { size: 20, cols, y: y2, ids: bo.bags[2].inventory.map(s => s?.id) },
  ] });
  const inv = await findInventory({ origin: [1402, 598], sample, characters: [ana, bo], iconFp: iconOf, bottom: 2000 });
  assert.equal(inv.ok, true, inv.reason);
  assert.equal(inv.character, "Bo");
  assert.equal(inv.cols, 5);
  assert.equal(Object.keys(inv.origins).length, 2);
  assert.ok(Math.abs(Object.values(inv.origins)[1][1] - y2) <= 2);
});

test("after a scroll, every tab is found again from one offset", async () => {
  const iconOf = iconSet(12);
  const r = rng(13);
  const tabs = Array.from({ length: 6 }, () => Array.from({ length: 30 }, () => (r() < 0.7 ? 1 + Math.floor(r() * 50) : null)));
  const pitch = 44, cols = 10, x0 = 700, stride = 3 * pitch + 36;
  // Calibrated with tabs 1 and 2 on screen; then the player (or the macro) scrolled down 2.4 tabs.
  const anchorY = 300, scrolled = -Math.round(2.4 * stride);
  const ys = t => anchorY + (t - 1) * stride + scrolled;
  const viewport = [anchorY - pitch, anchorY + 2 * stride];
  const visible = [1, 2, 3, 4, 5, 6].filter(t => ys(t) - pitch / 2 >= viewport[0] && ys(t) + 2 * pitch + pitch / 2 <= viewport[1]);
  const sample = drawSections({ x0, pitch, iconOf, emptyFp: EMPTY_FP, sections: visible.map(t => ({ size: 30, cols, y: ys(t), ids: tabs[t - 1] })) });
  const expected = i => (tabs[Math.floor(i / 30)][i % 30] ? { fp: iconOf(tabs[Math.floor(i / 30)][i % 30]) } : "empty");
  const res = await relocate({ sample, expected, tabCount: 6, layout: { x0, pitch, cols, stride, anchor: { id: 1, y: anchorY } }, viewport, range: [-3 * stride, 3 * stride] });
  assert.equal(res.ok, true, res.reason);
  assert.ok(Math.abs(res.offset - scrolled) <= 1, `offset ${res.offset}, scrolled ${scrolled}`);
  assert.deepEqual(Object.keys(res.origins).map(Number), visible);
});
