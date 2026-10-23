// The Settings panel: API key, look, alerts and hotkeys.
import { esc, coinText } from "../core/format.js";
import { readAt } from "./common.js";

let root, ctx, $;

const HOTKEYS = [
  ["toggle", "Show or hide the overlay"],
  ["through", "Let clicks pass through to the game"],
  ["calibrate", "Macro: mark a point"],
  ["step", "Macro: next step"],
  ["stop", "Macro: stop"],
  ["typeName", "Macro: type the item name"],
];

export default {
  id: "settings",
  title: "Settings",
  mount(el, context) {
    root = el;
    ctx = context;
    $ = sel => root.querySelector(sel);
    render();
    ctx.onAccount(renderAccount);
    root.addEventListener("submit", onSubmit);
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onHotkeyCapture);
  },
  show() { renderAccount(); },
};

function render() {
  const s = ctx.settings;
  const saved = ctx.keyStore.get();
  root.innerHTML = `
    <h2 class="section">Settings</h2>

    <form class="card" id="stKeyForm" novalidate>
      <h3>Your account</h3>
      <p id="stAccount" class="muted"></p>
      <label class="field" for="stKey">API key
        <input id="stKey" class="input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-…" value="${esc(saved || "")}">
      </label>
      <label class="row"><input type="checkbox" id="stRemember"${saved ? " checked" : ""}> Remember on this computer</label>
      <div class="row">
        <button class="btn" type="submit">Load my account</button>
        <button class="btn ghost" type="button" id="stExample">Use the example</button>
        ${saved ? `<button class="btn ghost" type="button" id="stForget">Forget my key</button>` : ""}
      </div>
      <p class="hint">Create a key at <a href="https://account.arena.net/applications" target="_blank" rel="noopener">account.arena.net/applications</a>.
        <b>account</b> and <b>inventories</b> are needed. Tick <b>characters</b> and <b>builds</b> for bags and gear, <b>unlocks</b> for wardrobe checks, and <b>progression</b> for collections and "done today". The key is sent only to api.guildwars2.com.</p>
    </form>

    <section class="card">
      <h3>Look</h3>
      <label class="field">Theme
        <select id="stTheme"><option value="dark"${s.theme === "dark" ? " selected" : ""}>Dark</option><option value="light"${s.theme === "light" ? " selected" : ""}>Light</option></select></label>
      <label class="field">Background opacity <input type="range" id="stOpacity" min="0.4" max="1" step="0.02" value="${s.opacity}"></label>
    </section>

    <section class="card">
      <h3>Warnings and alerts</h3>
      <label class="field">Flag cleanup items worth more than (gold)
        <input type="number" id="stHigh" class="input" min="0" step="1" value="${Math.round(s.highValue / 10000)}"></label>
      <label class="field">Alert this many minutes before a starred event
        <input type="number" id="stLead" class="input" min="1" max="60" step="1" value="${s.alertLead}"></label>
    </section>

    <form class="card" id="stKeys">
      <h3>Hotkeys</h3>
      <p class="muted">Click a box and press the keys you want. The overlay keys work everywhere; the macro keys only while the macro is armed.</p>
      ${HOTKEYS.map(([id, label]) => `<label class="field">${esc(label)}
        <input class="input hotkey" data-hotkey="${id}" value="${esc(s.hotkeys[id])}" readonly></label>`).join("")}
      <div class="row"><button class="btn" type="submit">Save hotkeys</button><button class="btn ghost" type="button" id="stKeysReset">Defaults</button></div>
    </form>

    <section class="card">
      <h3>About</h3>
      <p class="muted">GW2 Companion reads your account through ArenaNet's official API. It never changes anything on your account. Event schedules come from the Guild Wars 2 Wiki's event timer.</p>
      <p class="muted">Not affiliated with ArenaNet. Guild Wars 2 is a trademark of ArenaNet, LLC.</p>
    </section>`;
  renderAccount();
}

function renderAccount() {
  const el = $("#stAccount");
  if (!el) return;
  const a = ctx.getAccount();
  el.textContent = !a ? "Loading…"
    : a.source === "example" ? "Showing the example account. Add your key to see your own."
    : `Showing ${a.name}, read at ${readAt(a)}.`;
}

function onSubmit(e) {
  e.preventDefault();
  if (e.target.id === "stKeyForm") {
    const key = $("#stKey").value.trim();
    if (!key) { ctx.setStatus("Paste your API key first. You can create one on your ArenaNet account page.", true); return; }
    if (/\s/.test(key)) { ctx.setStatus("That key contains spaces. Copy it again from your ArenaNet account page.", true); return; }
    if ($("#stRemember").checked) ctx.keyStore.set(key); else ctx.keyStore.del();
    ctx.loadKey(key).then(a => { if (a) { ctx.toast(`Loaded ${a.name}.`); render(); } });
  } else if (e.target.id === "stKeys") {
    const hotkeys = { ...ctx.settings.hotkeys };
    root.querySelectorAll("[data-hotkey]").forEach(inp => { hotkeys[inp.dataset.hotkey] = inp.value; });
    const values = Object.values(hotkeys);
    if (new Set(values).size !== values.length) { ctx.setStatus("Two actions have the same key. Give each one its own.", true); return; }
    ctx.saveSettings({ hotkeys });
    ctx.rebindOverlayKeys();
    ctx.toast("Hotkeys saved.");
  }
}

function onClick(e) {
  if (e.target.closest("#stExample")) { ctx.loadExample().then(() => render()); return; }
  if (e.target.closest("#stForget")) { ctx.keyStore.del(); $("#stKey").value = ""; ctx.toast("Key forgotten on this computer."); render(); return; }
  if (e.target.closest("#stKeysReset")) {
    root.querySelectorAll("[data-hotkey]").forEach(inp => { inp.value = DEFAULTS[inp.dataset.hotkey]; });
  }
}

const DEFAULTS = {
  toggle: "CommandOrControl+Shift+G", through: "CommandOrControl+Shift+C",
  calibrate: "F7", step: "F8", stop: "F9", typeName: "F10",
};

function onInput(e) {
  const t = e.target;
  if (t.id === "stOpacity") ctx.saveSettings({ opacity: +t.value });
  if (t.id === "stTheme") ctx.saveSettings({ theme: t.value });
  if (t.id === "stHigh") ctx.saveSettings({ highValue: Math.max(0, Math.round(+t.value || 0)) * 10000 });
  if (t.id === "stLead") ctx.saveSettings({ alertLead: Math.min(60, Math.max(1, Math.round(+t.value || 5))) });
  if (t.id === "stHigh") t.title = `Rows worth ${coinText(ctx.settings.highValue)} or more get a warning badge.`;
}

// Turns a key press into a hotkey like "CommandOrControl+Shift+G" or "F8".
function onHotkeyCapture(e) {
  const inp = e.target.closest("[data-hotkey]");
  if (!inp || e.key === "Tab") return;
  e.preventDefault();
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (/^F\d{1,2}$/.test(key) === false && e.key.length !== 1 && !["Home", "End", "Insert", "Delete", "PageUp", "PageDown"].includes(key)) return;
  const parts = [];
  if (e.ctrlKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  // A bare letter would fire every time you typed it in game chat, so letters and numbers need a modifier.
  if (!parts.length && key.length === 1) { ctx.setStatus("Letters and numbers need Ctrl, Alt or Shift with them, or they'd fire while you type in game.", true); return; }
  inp.value = [...parts, key].join("+");
  ctx.setStatus("");
}
