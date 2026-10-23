// The marker window: a see-through layer over the game that draws rings around bank slots.
// Mouse clicks always pass through it.
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

getCurrentWindow().setIgnoreCursorEvents(true);

// rings: [{ x, y, size, label, tone }] in physical pixels relative to this window; scale = device pixels per CSS pixel.
listen("markers", ({ payload }) => {
  const { rings = [], scale = 1 } = payload || {};
  document.body.replaceChildren(...rings.flatMap(r => {
    const size = r.size / scale;
    const ring = document.createElement("div");
    ring.className = `ring ${r.tone || ""}`;
    Object.assign(ring.style, { left: `${r.x / scale - size / 2}px`, top: `${r.y / scale - size / 2}px`, width: `${size}px`, height: `${size}px` });
    if (!r.label) return [ring];
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = r.label;
    Object.assign(label.style, { left: `${r.x / scale}px`, top: `${r.y / scale - size / 2 - 6}px` });
    return [ring, label];
  }));
});
