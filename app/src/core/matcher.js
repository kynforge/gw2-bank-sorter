// Checks that a bank slot on screen shows the item the plan expects, before the macro touches it.
// A fingerprint is the slot's central half shrunk to 8×8 RGB (192 numbers), made the same way for the
// screen capture and for the API's item icon. When in doubt it says no.

function pearson(a, b) {
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

// 0–1: half shape (correlation), half colour (mean difference). Flat images only count colour.
export function similarity(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  const colour = 1 - diff / a.length / 255;
  const r = pearson(a, b);
  return r === null ? colour : ((r + 1) / 2 + colour) / 2;
}

// expected: { key, fp } for an item, or "empty". candidates: the other icons that could be there.
export function judge(fp, expected, candidates, emptyFp, { threshold = 0.8, margin = 0.05 } = {}) {
  const isEmpty = expected === "empty";
  if (isEmpty && !emptyFp) return { ok: false, score: 0, best: null, reason: "I don't know what an empty slot looks like yet. Run Verify first." };
  const want = isEmpty ? { key: "an empty slot", fp: emptyFp } : expected;
  const score = similarity(fp, want.fp);
  const others = candidates.filter(c => c.key !== want.key && c.fp);
  if (!isEmpty && emptyFp) others.push({ key: "an empty slot", fp: emptyFp });
  let best = null;
  for (const c of others) {
    const s = similarity(fp, c.fp);
    if (!best || s > best.score) best = { key: c.key, score: s };
  }
  if (best && best.score >= score) return { ok: false, score, best, reason: `The slot looks more like ${best.key} than ${want.key}.` };
  if (score < threshold) return { ok: false, score, best, reason: `The slot doesn't look like ${want.key} (match ${Math.round(score * 100)}%).` };
  if (best && score - best.score < margin) return { ok: false, score, best, reason: `Can't tell ${want.key} from ${best.key} here.` };
  return { ok: true, score, best, reason: "" };
}
