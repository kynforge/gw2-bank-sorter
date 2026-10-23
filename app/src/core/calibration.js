// Where the bank's slots are on screen, from a few points the player marks with the calibration key.
import { TAB_SIZE } from "./account.js";
import { store } from "./api.js";

// Slot spacing from the centre of a tab's first slot and the last slot in that row.
export function pitchFrom(first, rowEnd, cols) {
  if (!(cols >= 2)) throw new Error("Enter how many slots per row your bank shows (2 or more).");
  const dx = rowEnd[0] - first[0];
  if (dx <= 0) throw new Error("The second point should be to the right of the first: the last slot in the row, not the first.");
  const pitch = dx / (cols - 1);
  if (Math.abs(rowEnd[1] - first[1]) > pitch / 2) throw new Error("The two points should be on the same row of slots. Try again.");
  return pitch;
}

// Screen centre of a bank slot, or null when its tab hasn't been marked.
export function slotCenter(calib, index) {
  const origin = calib.tabs[Math.floor(index / TAB_SIZE) + 1];
  if (!origin) return null;
  const pos = index % TAB_SIZE;
  return [Math.round(origin[0] + (pos % calib.cols) * calib.pitch), Math.round(origin[1] + Math.floor(pos / calib.cols) * calib.pitch)];
}

// The square captured for a slot: a little inside its spacing, so neighbours stay out.
export const slotSize = calib => Math.round(calib.pitch * 0.88);

export function averageFingerprints(list) {
  if (!list.length) return null;
  const out = new Uint8Array(list[0].length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(list.reduce((n, fp) => n + fp[i], 0) / list.length);
  return out;
}

// Calibration is saved per screen resolution, since slot positions change with it.
export const calibrationKey = (w, h) => `gw2c.calibration.${Math.round(w)}x${Math.round(h)}`;
export const emptyCalibration = () => ({ pitch: 0, cols: 10, tabs: {}, drop: null, emptyFp: null });
export function loadCalibration(key) {
  try {
    const c = JSON.parse(store.get(key) || "null");
    return c && c.pitch ? { ...emptyCalibration(), ...c } : emptyCalibration();
  } catch { return emptyCalibration(); }
}
export function saveCalibration(key, calib) {
  store.set(key, JSON.stringify({ ...calib, emptyFp: calib.emptyFp ? [...calib.emptyFp] : null }));
}
