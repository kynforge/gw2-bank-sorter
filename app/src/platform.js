// The only module that talks to Tauri. In a plain browser every call falls back to something safe,
// so the panels can be built and checked there without the desktop app.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function invoke(cmd, args) {
  if (!isDesktop) return Promise.reject(new Error("Only in the desktop app."));
  return tauriInvoke(cmd, args);
}

const appWindow = isDesktop ? getCurrentWindow() : null;

export const win = {
  async toggleVisible() {
    if (!appWindow) return;
    if (await appWindow.isVisible()) await appWindow.hide();
    else await appWindow.show();
  },
  async setClickThrough(on) { await appWindow?.setIgnoreCursorEvents(on); },
  async minimize() { await appWindow?.minimize(); },
  async close() { await appWindow?.close(); },
};

/* ---------- Hotkeys ---------- */

// "CommandOrControl+Shift+G" and a keydown event both reduce to "ctrl+shift+g" for the browser fallback.
function normalize(accel) {
  return accel.split("+").map(p => p.trim().toLowerCase())
    .map(p => (p === "commandorcontrol" || p === "cmdorctrl" || p === "control") ? "ctrl" : p)
    .sort((a, b) => (["ctrl", "alt", "shift"].indexOf(a) + 1 || 9) - (["ctrl", "alt", "shift"].indexOf(b) + 1 || 9))
    .join("+");
}
function eventAccel(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  return parts.join("+");
}

const browserKeys = new Map();
if (!isDesktop && typeof window !== "undefined") {
  window.addEventListener("keydown", e => {
    const fn = browserKeys.get(eventAccel(e));
    if (fn) { e.preventDefault(); fn(); }
  });
}

export const hotkeys = {
  // Registers a global hotkey. A key another program already holds fails with a readable error.
  async register(accel, fn) {
    if (!isDesktop) { browserKeys.set(normalize(accel), fn); return; }
    await unregister(accel).catch(() => {});
    await register(accel, event => { if (event.state === "Pressed") fn(); });
  },
  async unregister(accel) {
    if (!isDesktop) { browserKeys.delete(normalize(accel)); return; }
    await unregister(accel).catch(() => {});
  },
};

/* ---------- On-screen markers ---------- */

let markerWindow = null;
let markerTimer = 0;

async function ensureMarkerWindow() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  markerWindow ||= await WebviewWindow.getByLabel("marker");
  if (markerWindow) return markerWindow;
  markerWindow = new WebviewWindow("marker", {
    url: "marker.html", title: "GW2 Companion markers",
    transparent: true, decorations: false, alwaysOnTop: true, skipTaskbar: true,
    focus: false, focusable: false, resizable: false, shadow: false, visible: false,
  });
  await new Promise((resolve, reject) => {
    markerWindow.once("tauri://created", resolve);
    markerWindow.once("tauri://error", e => { markerWindow = null; reject(new Error(String(e.payload))); });
  });
  return markerWindow;
}

// Rings around points on screen (physical pixels), drawn in a click-through window over the game.
export const markers = {
  async show(rings, { hideAfter = 0 } = {}) {
    if (!isDesktop || !rings.length) return;
    const { monitorFromPoint, availableMonitors } = await import("@tauri-apps/api/window");
    const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/dpi");
    const { emitTo } = await import("@tauri-apps/api/event");
    const m = await ensureMarkerWindow();
    const mon = (await monitorFromPoint(rings[0].x, rings[0].y)) || (await availableMonitors())[0];
    await m.setPosition(new PhysicalPosition(mon.position.x, mon.position.y));
    await m.setSize(new PhysicalSize(mon.size.width, mon.size.height));
    await m.show();
    await emitTo("marker", "markers", {
      rings: rings.map(r => ({ ...r, x: r.x - mon.position.x, y: r.y - mon.position.y })),
      scale: mon.scaleFactor,
    });
    clearTimeout(markerTimer);
    if (hideAfter) markerTimer = setTimeout(() => markers.hide(), hideAfter);
  },
  async hide() {
    clearTimeout(markerTimer);
    if (!isDesktop) return;
    await markerWindow?.hide().catch(() => {});
  },
};

/* ---------- Notifications and clipboard ---------- */

export async function notify(title, body) {
  try {
    if (isDesktop) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
      return;
    }
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission === "granted") new Notification(title, { body });
  } catch { /* alerts are a nicety; never let them break the timers */ }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
