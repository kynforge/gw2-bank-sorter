// Finds a grid of item slots on screen (bank tabs, or a character's bags) from a single point: the
// middle of its first slot. It knows from the API what each slot should hold, so it tries slot
// spacings, row widths and section positions until the item icons line up.
//
// sample(rects) reads the screen: each rect is [centre x, centre y, size], and it returns fingerprints.
// expected(index) is { fp } for a slot holding an item, "empty", or null when there's nothing to compare.
// sections are the grid's blocks in screen order (bank tabs of 30, or bags of their own size).
import { similarity } from "./matcher.js";

const MATCH = 0.8;      // a slot this similar to its icon counts as a match
const ACCEPT = 0.72;    // the average a candidate needs before it's believed
const PROBE = 6;        // slots along the first row used to find the spacing
const MIN_COLS = 4;     // narrowest row the finder expects (inventory windows can be narrow)

export const bankSections = tabCount => Array.from({ length: tabCount }, (_, k) => ({ id: k + 1, start: k * 30, size: 30 }));
const range = (from, to, step) => { const out = []; for (let v = from; v <= to + 1e-9; v += step) out.push(+v.toFixed(3)); return out; };
const slotSize = pitch => Math.round(pitch * 0.88);
const fail = reason => ({ ok: false, reason });

// Mean similarity over the slots that hold an item with a known icon.
function score(fps, items) {
  let sum = 0, n = 0;
  items.forEach((exp, k) => {
    if (!exp || exp === "empty" || !exp.fp || !fps[k]) return;
    sum += similarity(fps[k], exp.fp);
    n++;
  });
  return { score: n ? sum / n : 0, items: n };
}

const better = (a, b) => !b || a.score > b.score;

export async function findGrid({ origin, sample, expected, tabCount, sections = bankSections(tabCount), bottom = Infinity, minPitch = 28, maxPitch = 130 }) {
  const [ox, oy] = origin;
  const rowOf = (s, cols) => Math.ceil(s.size / cols);
  const firstRow = s => Array.from({ length: Math.min(PROBE, s.size) }, (_, k) => expected(s.start + k));

  // 1. Spacing and which section is under the point, from the first few slots of each section.
  const pitches = range(minPitch, maxPitch, 1);
  const probe = (x, y, P) => Array.from({ length: PROBE }, (_, k) => [Math.round(x + k * P), Math.round(y), slotSize(P)]);
  let fps = await sample(pitches.flatMap(P => probe(ox, oy, P)));
  let best = null;
  pitches.forEach((P, i) => {
    const row = fps.slice(i * PROBE, (i + 1) * PROBE);
    for (const s of sections) {
      // A narrow window wraps before the sixth slot, so the first 4, 5 or 6 slots are tried.
      for (let L = MIN_COLS; L <= PROBE; L++) {
        const sc = { P, s, L, ...score(row.slice(0, L), firstRow(s).slice(0, L)) };
        if (sc.items >= 3 && better(sc, best)) best = sc;
      }
    }
  });
  if (!best || best.score < ACCEPT) return fail("Couldn't find the slots at that point. Hover over the middle of the first slot of the top section you can see (with a few items in its first row) and try again.");

  // 2. Nudge the point to the middle of the slot, then fine-tune the spacing.
  let P = best.P, x0 = ox, y0 = oy;
  const reach = Math.round(P * 0.3);
  const offsets = range(-reach, reach, 2).flatMap(dx => range(-reach, reach, 2).map(dy => [dx, dy]));
  fps = await sample(offsets.flatMap(([dx, dy]) => probe(ox + dx, oy + dy, P)));
  let bestOff = null;
  offsets.forEach(([dx, dy], i) => {
    const sc = { dx, dy, ...score(fps.slice(i * PROBE, i * PROBE + best.L), firstRow(best.s).slice(0, best.L)) };
    if (better(sc, bestOff)) bestOff = sc;
  });
  // Position and spacing pull on each other (a slightly wrong start makes a slightly wrong spacing
  // look best), so the last step searches both together.
  const joint = range(-2, 2, 1).flatMap(dx => range(-2, 2, 1).flatMap(dy => range(P - 1, P + 1, 0.25).map(p => [ox + bestOff.dx + dx, oy + bestOff.dy + dy, p])));
  fps = await sample(joint.flatMap(([x, y, p]) => probe(x, y, p)));
  let bestFit = null;
  joint.forEach(([x, y, p], i) => { const sc = { x, y, p, ...score(fps.slice(i * PROBE, i * PROBE + best.L), firstRow(best.s).slice(0, best.L)) }; if (better(sc, bestFit)) bestFit = sc; });
  x0 = bestFit.x; y0 = bestFit.y; P = bestFit.p;

  // 3. Slots per row: lay a wide grid over the section and see which row width puts every icon in place.
  const GRID_COLS = 20, GRID_ROWS = 4;
  const grid = [];
  for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) grid.push([Math.round(x0 + c * P), Math.round(y0 + r * P), slotSize(P)]);
  fps = await sample(grid);
  let bestCols = null;
  for (let C = MIN_COLS; C <= GRID_COLS; C++) {
    const got = [], want = [];
    for (let pos = 0; pos < best.s.size; pos++) {
      const c = pos % C, r = Math.floor(pos / C);
      if (r >= GRID_ROWS) break;
      got.push(fps[r * GRID_COLS + c]);
      want.push(expected(best.s.start + pos));
    }
    const sc = { C, ...score(got, want) };
    if (sc.items >= 5 && better(sc, bestCols)) bestCols = sc;
  }
  if (!bestCols || bestCols.score < ACCEPT) return fail("Found the first row but not how wide the rows are. Make the window a little wider or taller and try again.");
  const cols = bestCols.C;

  // 4. The sections below, one after another, each found by all of its slots (headers sit between them).
  const sectionRects = (s, x, y) => Array.from({ length: s.size }, (_, pos) => [Math.round(x + (pos % cols) * P), Math.round(y + Math.floor(pos / cols) * P), slotSize(P)]);
  const sectionWants = s => Array.from({ length: s.size }, (_, pos) => expected(s.start + pos));
  const origins = { [best.s.id]: [x0, y0] };
  let prev = best.s, prevY = y0;
  for (let idx = sections.indexOf(best.s) + 1; idx < sections.length; idx++) {
    const s = sections[idx];
    const yStart = prevY + rowOf(prev, cols) * P;
    const lastRowAt = y => y + (rowOf(s, cols) - 1) * P + P / 2;
    const ys = range(yStart, yStart + 3 * P, 2).filter(y => lastRowAt(y) <= bottom);
    if (!ys.length) break;
    fps = await sample(ys.flatMap(y => sectionRects(s, x0, y)));
    let bestY = null;
    ys.forEach((y, i) => { const sc = { y, ...score(fps.slice(i * s.size, (i + 1) * s.size), sectionWants(s)) }; if (sc.items >= 3 && better(sc, bestY)) bestY = sc; });
    if (!bestY || bestY.score < ACCEPT) break;
    // Settle on the exact pixel.
    const near = range(bestY.y - 2, bestY.y + 2, 1).filter(y => lastRowAt(y) <= bottom);
    fps = await sample(near.flatMap(y => sectionRects(s, x0, y)));
    near.forEach((y, i) => { const sc = { y, ...score(fps.slice(i * s.size, (i + 1) * s.size), sectionWants(s)) }; if (better(sc, bestY)) bestY = sc; });
    origins[s.id] = [x0, bestY.y];
    prev = s;
    prevY = bestY.y;
  }

  // 5. How well every found slot matches, and what an empty slot looks like here.
  const found = sections.filter(s => origins[s.id]);
  const all = found.flatMap(s => sectionRects(s, ...origins[s.id]));
  fps = await sample(all);
  const wants = found.flatMap(sectionWants);
  let matched = 0, checked = 0;
  const empties = [];
  wants.forEach((exp, k) => {
    if (exp === "empty") { empties.push(fps[k]); return; }
    if (!exp?.fp) return;
    checked++;
    if (similarity(fps[k], exp.fp) >= MATCH) matched++;
  });
  const emptyFp = empties.length ? Uint8Array.from({ length: 192 }, (_, i) => Math.round(empties.reduce((n, fp) => n + fp[i], 0) / empties.length)) : null;
  return { ok: true, pitch: P, cols, origins, tabs: origins, matched, checked, emptyFp };
}

// Remembers fingerprints already read, so trying the same points for several characters reads the
// screen once.
export function cachedSampler(sample) {
  const seen = new Map();
  return async rects => {
    const key = r => r.join(",");
    const todo = rects.filter(r => !seen.has(key(r)));
    if (todo.length) (await sample(todo)).forEach((fp, k) => seen.set(key(todo[k]), fp));
    return rects.map(r => seen.get(key(r)));
  };
}

// A character's bags as one list of slots, and as sections (one per bag, in order).
export function bagLayout(character) {
  const cells = [], sections = [];
  (character.bags || []).forEach((bag, b) => {
    if (!bag) return;
    sections.push({ id: b + 1, start: cells.length, size: bag.size });
    for (let k = 0; k < bag.size; k++) cells.push(bag.inventory?.[k] || null);
  });
  return { cells, sections };
}

// The inventory window: tries every character's bags against the screen and keeps the best fit,
// which also tells us who is logged in.
// characters: [{ name, bags }] as the API gives them, or layouts: [{ name, cells, sections }] already flattened.
export async function findInventory({ origin, sample, characters, layouts, iconFp, bottom = Infinity }) {
  const read = cachedSampler(sample);
  let best = null;
  for (const ch of layouts || characters.map(c => ({ name: c.name, ...bagLayout(c) }))) {
    const { cells, sections } = ch;
    if (!sections.length) continue;
    const expected = i => {
      if (!cells[i]) return "empty";
      const fp = iconFp(cells[i].id);
      return fp ? { fp } : null;
    };
    const g = await findGrid({ origin, sample: read, expected, sections, bottom });
    if (!g.ok || !g.checked) continue;
    const rate = g.matched / g.checked;
    if (!best || rate > best.rate) best = { ...g, character: ch.name, rate, cells, sections };
  }
  if (!best || best.rate < 0.6) return { ok: false, reason: "Couldn't match the bags on screen to any of your characters. Open your inventory, hover over the middle of its first slot and try again. If you just picked things up, wait a few minutes and press Refresh." };
  return best;
}

// After the bank window scrolls, every tab has moved by the same amount. Finds that amount, and
// returns the tabs now fully on screen. layout.stride is the distance between one tab's first slot
// and the next one's.
export async function relocate({ sample, expected, tabCount, layout, viewport, range: [lo, hi], step }) {
  const { x0, pitch: P, cols, stride, anchor } = layout;
  const rows = Math.ceil(30 / cols);
  const [top, bottom] = viewport;
  const yOf = (t, offset) => anchor.y + (t - anchor.id) * stride + offset;
  const fits = (t, offset) => yOf(t, offset) - P / 2 >= top && yOf(t, offset) + (rows - 1) * P + P / 2 <= bottom;
  const tabs = Array.from({ length: tabCount }, (_, k) => k + 1);
  const firstRow = (t, offset) => Array.from({ length: Math.min(cols, 30) }, (_, c) => [Math.round(x0 + c * P), Math.round(yOf(t, offset) + 0), slotSize(P)]);
  const wants = t => Array.from({ length: Math.min(cols, 30) }, (_, c) => expected((t - 1) * 30 + c));

  const tryOffsets = async offsets => {
    const plan = offsets.map(offset => ({ offset, tabs: tabs.filter(t => fits(t, offset)) }));
    const rects = plan.flatMap(p => p.tabs.flatMap(t => firstRow(t, p.offset)));
    const fps = await sample(rects);
    let at = 0, best = null;
    for (const p of plan) {
      const got = fps.slice(at, at + p.tabs.length * Math.min(cols, 30));
      at += got.length;
      const sc = { offset: p.offset, tabs: p.tabs, ...score(got, p.tabs.flatMap(wants)) };
      if (sc.items >= 4 && better(sc, best)) best = sc;
    }
    return best;
  };

  const coarse = step || Math.max(2, Math.round(P / 8));
  let best = await tryOffsets(range(lo, hi, coarse).map(Math.round));
  if (!best) return { ok: false, reason: "Can't see enough items in the bank to know where it scrolled to." };
  best = await tryOffsets(range(best.offset - coarse, best.offset + coarse, 1)) || best;
  if (best.score < ACCEPT) return { ok: false, reason: "The bank doesn't look like the plan after scrolling. Press Refresh in the Bank tab, wait a few minutes and start again." };
  return { ok: true, offset: best.offset, origins: Object.fromEntries(best.tabs.map(t => [t, [x0, yOf(t, best.offset)]])) };
}
