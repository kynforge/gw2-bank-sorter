// The overlay shell: tabs, status line, toast, settings and the shared account, handed to each panel as ctx.
import "./styles/base.css";
import "./styles/shell.css";
import { win, hotkeys } from "./platform.js";
import { loadAccount, loadExample } from "./core/account.js";
import { UserError, store } from "./core/api.js";
import { boot } from "./core/boot.js";
import today from "./ui/today.js";
import bank from "./ui/bank.js";
import find from "./ui/find.js";
import builds from "./ui/builds.js";
import macro from "./ui/macro.js";
import settingsPanel from "./ui/settings.js";

const $ = sel => document.querySelector(sel);

/* ---------- Settings ---------- */

const SETTINGS_STORE = "gw2c.settings";
export const DEFAULT_SETTINGS = {
  theme: "dark", opacity: 0.94, tab: "today",
  highValue: 100000,          // copper: rows worth more than this get a "High value" badge
  alertLead: 5,               // minutes before a starred event to send an alert
  favourites: [], hiddenCats: ["Special Events"],
  hotkeys: {
    toggle: "CommandOrControl+Shift+G", through: "CommandOrControl+Shift+C",
    calibrate: "F7", step: "F8", stop: "F9", typeName: "F10",
  },
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORE) || "{}");
    return { ...DEFAULT_SETTINGS, ...saved, hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...(saved.hotkeys || {}) } };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

/* ---------- Context shared with panels ---------- */

const settingsListeners = new Set();
const accountListeners = new Set();
let account = null;

const ctx = {
  settings: loadSettings(),
  saveSettings(patch = {}) {
    Object.assign(ctx.settings, patch);
    try { localStorage.setItem(SETTINGS_STORE, JSON.stringify(ctx.settings)); } catch { /* storage blocked */ }
    applyLook();
    settingsListeners.forEach(fn => fn(ctx.settings));
  },
  onSettings(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn); },
  getAccount: () => account,
  setAccount(a) { account = a; accountListeners.forEach(fn => fn(a)); },
  onAccount(fn) { accountListeners.add(fn); return () => accountListeners.delete(fn); },
  setStatus(msg, isError = false) {
    const el = $("#status");
    el.className = "status" + (isError ? " error" : "");
    el.textContent = msg || "";
  },
  toast,
  showTab,
};

/* ---------- Account loading ---------- */

const KEY_STORE = "gw2c.key";
export const CAP_STORE = "gw2c.capacity";
let loading = null;

// A failed load leaves the previous account in place, so the panels keep working with what they had.
function load(fn, { keepStatus = false } = {}) {
  if (loading) return loading;
  ctx.loading = true;
  loading = (async () => {
    try {
      const a = await fn();
      ctx.setAccount(a);
      if (!keepStatus) ctx.setStatus("");
      // Collections arrive later on a real account; panels re-render when they do.
      a.needsReady?.then(() => { if (account === a) ctx.setAccount(a); });
      return a;
    } catch (err) {
      ctx.setStatus(err instanceof UserError ? err.message : `Something went wrong while reading the API: ${err.message}`, true);
      return null;
    } finally {
      loading = null;
      ctx.loading = false;
    }
  })();
  return loading;
}
ctx.loadKey = key => load(() => loadAccount(key, { onStatus: m => ctx.setStatus(m), capacity: parseInt(store.get(CAP_STORE), 10) }));
// keepStatus leaves an earlier error showing (and doesn't overwrite it with progress messages).
ctx.loadExample = ({ keepStatus = false } = {}) =>
  load(() => loadExample({ onStatus: m => { if (!keepStatus) ctx.setStatus(m); } }), { keepStatus });
ctx.refresh = () => account?.source === "account" ? ctx.loadKey(account.key) : ctx.loadExample();
ctx.keyStore = { get: () => store.get(KEY_STORE), set: k => store.set(KEY_STORE, k), del: () => store.del(KEY_STORE) };

/* ---------- Look ---------- */

function applyLook() {
  document.documentElement.dataset.theme = ctx.settings.theme;
  document.documentElement.style.setProperty("--opacity", String(ctx.settings.opacity));
}

let toastTimer = 0;
function toast(msg, undo) {
  const el = $("#toast");
  el.replaceChildren(Object.assign(document.createElement("span"), { textContent: msg }));
  if (undo) {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: "Undo" });
    b.addEventListener("click", () => { el.hidden = true; undo(); });
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

/* ---------- Tabs ---------- */

const panels = [today, bank, find, builds, macro, settingsPanel];
const mounted = new Map();

function showTab(id) {
  const target = panels.find(p => p.id === id) || panels[0];
  for (const p of panels) {
    const tab = document.getElementById(`tab-${p.id}`);
    tab.setAttribute("aria-selected", String(p === target));
    tab.tabIndex = p === target ? 0 : -1;
    const root = document.getElementById(`panel-${p.id}`);
    root.hidden = p !== target;
    if (p === target && !mounted.has(p.id)) { mounted.set(p.id, true); p.mount(root, ctx); }
    if (p === target) p.show?.();
    else if (mounted.has(p.id)) p.hide?.();
  }
  if (ctx.settings.tab !== target.id) ctx.saveSettings({ tab: target.id });
}

function buildTabs() {
  const el = (tag, attrs) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  $("#tabbar").replaceChildren(...panels.map(p => {
    const b = el("button", { type: "button", id: `tab-${p.id}`, role: "tab", "aria-selected": "false", "aria-controls": `panel-${p.id}` });
    b.textContent = p.title;
    return b;
  }));
  $("#panels").replaceChildren(...panels.map(p =>
    el("section", { id: `panel-${p.id}`, class: "panel", role: "tabpanel", "aria-labelledby": `tab-${p.id}`, hidden: "" })));
  $("#tabbar").addEventListener("click", e => {
    const b = e.target.closest("[role=tab]");
    if (b) showTab(b.id.slice(4));
  });
  $("#tabbar").addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = panels.findIndex(p => document.getElementById(`tab-${p.id}`) === document.activeElement);
    const next = panels[(i + (e.key === "ArrowRight" ? 1 : panels.length - 1)) % panels.length];
    showTab(next.id);
    document.getElementById(`tab-${next.id}`).focus();
  });
}

/* ---------- Overlay hotkeys ---------- */

let through = false;
async function setThrough(on) {
  through = on;
  $("#shell").classList.toggle("through", on);
  $("#ctFlag").hidden = !on;
  await win.setClickThrough(on);
}

let bound = {};
async function bindOverlayKeys() {
  const k = ctx.settings.hotkeys;
  for (const accel of Object.values(bound)) await hotkeys.unregister(accel);
  bound = {};
  const tries = [["toggle", () => win.toggleVisible()], ["through", () => setThrough(!through)]];
  const failed = [];
  for (const [name, fn] of tries) {
    try { await hotkeys.register(k[name], fn); bound[name] = k[name]; }
    catch { failed.push(k[name]); }
  }
  if (failed.length) ctx.setStatus(`Couldn't use ${failed.join(" and ")} as a hotkey. Another program may have it. Pick a different key in Settings.`, true);
}
ctx.rebindOverlayKeys = bindOverlayKeys;

/* ---------- Start ---------- */

$("#winMin").addEventListener("click", () => win.minimize());
$("#winClose").addEventListener("click", () => win.close());
applyLook();
buildTabs();
showTab(ctx.settings.tab);
bindOverlayKeys();
boot({ savedKey: ctx.keyStore.get(), loadKey: ctx.loadKey, loadExample: ctx.loadExample });
