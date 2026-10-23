// The Today panel: what's on soon, what's already done today, and Wizard's Vault progress.
import data from "../data/event-timers.json";
import { esc, plural } from "../core/format.js";
import { occurrences, doneToday, WORLD_BOSS_API_IDS, MAPCHEST_EVENT_IDS } from "../core/timers.js";
import { nextDailyReset, nextWeeklyReset, formatCountdown } from "../core/daily.js";
import { iconSVG } from "./common.js";
import { copyText, notify } from "../platform.js";

// Not things to go and do: day/night cycles and PvP tournament rotations.
const SKIP_EVENTS = new Set(["t", "core-dn", "eod-dn", "voe-dn", "core-ateu", "core-atna"]);
const WINDOW = 120 * 60_000;      // how far ahead the list looks
const SOON = 30 * 60_000;

let root, ctx, $;
let visible = false;
let onlyStarred = false;
const alerted = new Set();

export default {
  id: "today",
  title: "Today",
  mount(el, context) {
    root = el;
    ctx = context;
    $ = sel => root.querySelector(sel);
    root.innerHTML = `
      <div class="today-head">
        <h2 class="section">Today</h2>
        <p class="lead" id="tdResets"></p>
      </div>
      <div class="filters" id="tdCats" role="group" aria-label="Show event categories"></div>
      <div id="tdEvents"></div>
      <section class="card" id="tdDone" aria-labelledby="tdDoneTitle"></section>
      <section class="card" id="tdVault" aria-labelledby="tdVaultTitle"></section>
      <p class="muted small-print">Schedule data from the Guild Wars 2 Wiki event timer. Done-today ticks come from the API and can be a few minutes behind.</p>`;
    root.addEventListener("click", onClick);
    ctx.onAccount(() => { renderDone(); renderVault(); renderEvents(); });
    ctx.onSettings(() => { renderCats(); renderEvents(); });
    renderCats();
    renderAll();
    // Alerts keep running while other tabs are open; the list only redraws while this one is.
    setInterval(() => { checkAlerts(); if (visible) { renderEvents(); renderResets(); } }, 15_000);
  },
  show() { visible = true; renderAll(); },
  hide() { visible = false; },
};

function renderAll() {
  renderResets();
  renderEvents();
  renderDone();
  renderVault();
}

function renderResets() {
  const now = Date.now();
  $("#tdResets").textContent = `Daily reset in ${formatCountdown(nextDailyReset(now) - now)} · weekly reset in ${formatCountdown(nextWeeklyReset(now) - now)}`;
}

const categories = () => [...new Set(Object.entries(data.events).filter(([id, e]) => !SKIP_EVENTS.has(id) && e.category).map(([, e]) => e.category))];
const favourites = () => new Set(ctx.settings.favourites);

function renderCats() {
  const hidden = new Set(ctx.settings.hiddenCats);
  const cats = categories();
  const wasOpen = $("#tdCats details")?.open;
  $("#tdCats").innerHTML =
    `<button type="button" class="chip all" data-starred aria-pressed="${onlyStarred}">${iconSVG("star")} Starred only</button>
    <details class="catpick"${wasOpen ? " open" : ""}><summary>Categories <span class="muted">${cats.filter(c => !hidden.has(c)).length} of ${cats.length}</span></summary>
      <div class="filters">${cats.map(c => `<button type="button" class="chip all" data-cat="${esc(c)}" aria-pressed="${!hidden.has(c)}">${esc(c)}</button>`).join("")}</div>
    </details>`;
}

function upcoming(now) {
  const hidden = new Set(ctx.settings.hiddenCats);
  const favs = favourites();
  return occurrences(data, now, now + WINDOW)
    .filter(o => !SKIP_EVENTS.has(o.eventId) && !hidden.has(o.category))
    .filter(o => !onlyStarred || favs.has(o.name));
}

function rowHTML(o, now, favs, done) {
  const isDone = doneToday(o, done) === true;
  const live = o.start <= now;
  const when = live ? `ends in ${formatCountdown(o.end - now)}` : `in ${formatCountdown(o.start - now)}`;
  const time = new Date(o.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const star = favs.has(o.name);
  return `<li class="ev${isDone ? " done" : ""}${live ? " live" : ""}">
    <button type="button" class="iconbtn star" data-fav="${esc(o.name)}" aria-pressed="${star}" aria-label="${star ? "Unstar" : "Star"} ${esc(o.name)}">${iconSVG("star")}</button>
    <div class="ev-text"><b>${esc(o.name)}</b>${isDone ? ` <span class="badge ok">Done today</span>` : ""}
      <span class="muted">${esc(o.mapName)} · ${esc(time)}</span></div>
    <span class="ev-when">${esc(when)}</span>
    ${o.chatlink ? `<button type="button" class="iconbtn" data-copy="${esc(o.chatlink)}" title="Copy the waypoint, then paste it in game chat">${iconSVG("copy")}<span> Waypoint</span></button>` : "<span></span>"}
  </li>`;
}

function renderEvents() {
  if (!root) return;
  const now = Date.now();
  const favs = favourites();
  const done = ctx.getAccount()?.done || null;
  const list = upcoming(now);
  // Things not done today first, so the list reads as "what to do next".
  const order = (a, b) => (doneToday(a, done) === true) - (doneToday(b, done) === true) || a.start - b.start;
  const groups = [
    ["Happening now", list.filter(o => o.start <= now).sort(order)],
    ["Next 30 minutes", list.filter(o => o.start > now && o.start - now <= SOON).sort(order)],
    ["Later", list.filter(o => o.start - now > SOON).sort(order)],
  ].filter(([, rows]) => rows.length);
  $("#tdEvents").innerHTML = groups.length
    ? groups.map(([title, rows]) => `<section class="evgroup"><h3>${esc(title)}</h3><ol class="evlist">${rows.map(o => rowHTML(o, now, favs, done)).join("")}</ol></section>`).join("")
    : `<div class="empty-plan">${onlyStarred ? "None of your starred events are on in the next two hours." : "Nothing in the next two hours for the categories you picked."}</div>`;
}

function tick(done, label) {
  return `<li class="${done ? "yes" : ""}"><span aria-hidden="true">${done ? "✓" : "○"}</span> ${esc(label)}<span class="sr">${done ? ": done" : ": not done"}</span></li>`;
}

const pretty = id => id.replace(/_heros_choice_chest$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

function renderDone() {
  const account = ctx.getAccount();
  const el = $("#tdDone");
  const done = account?.done;
  if (!done || (!done.worldbosses && !done.mapchests && !done.dailycrafting)) {
    el.innerHTML = `<h3 id="tdDoneTitle">Done today</h3><p class="muted">Needs an API key with the progression permission. Add one in Settings.</p>`;
    return;
  }
  const bosses = Object.entries(WORLD_BOSS_API_IDS);
  const chests = Object.entries(MAPCHEST_EVENT_IDS).map(([eventId, id]) => [data.events[eventId]?.name || pretty(id), id]);
  const crafting = ["charged_quartz_crystal", "glob_of_elder_spirit_residue", "lump_of_mithrilium", "spool_of_silk_weaving_thread", "spool_of_thick_elonian_cord"];
  const count = (set, ids) => set ? ids.filter(id => set.has(id)).length : 0;
  el.innerHTML = `<h3 id="tdDoneTitle">Done today</h3>
    ${done.worldbosses ? `<details><summary>World bosses <span class="muted">${count(done.worldbosses, bosses.map(b => b[1]))} of ${bosses.length}</span></summary>
      <ul class="ticks">${bosses.map(([name, id]) => tick(done.worldbosses.has(id), name)).join("")}</ul></details>` : ""}
    ${done.mapchests ? `<details><summary>Meta chests <span class="muted">${count(done.mapchests, chests.map(c => c[1]))} of ${chests.length}</span></summary>
      <ul class="ticks">${chests.map(([name, id]) => tick(done.mapchests.has(id), name)).join("")}</ul></details>` : ""}
    ${done.dailycrafting ? `<details><summary>Daily crafting <span class="muted">${count(done.dailycrafting, crafting)} of ${crafting.length}</span></summary>
      <ul class="ticks">${crafting.map(id => tick(done.dailycrafting.has(id), pretty(id))).join("")}</ul></details>` : ""}`;
}

function vaultTrack(title, track) {
  if (!track?.objectives?.length) return "";
  const meta = track.meta_progress_complete
    ? `<span class="muted">${track.meta_progress_current} of ${track.meta_progress_complete}${track.meta_reward_claimed ? ", reward claimed" : ""}</span>` : "";
  const rows = track.objectives.map(o => {
    const pct = o.progress_complete ? Math.min(100, (o.progress_current / o.progress_complete) * 100) : 0;
    const finished = o.progress_current >= o.progress_complete;
    return `<li class="${o.claimed ? "claimed" : finished ? "ready" : ""}">
      <div class="row"><span>${esc(o.title)}</span><span class="muted">${o.claimed ? "Claimed" : finished ? "Ready to claim" : `${o.progress_current} / ${o.progress_complete}`} · ${o.acclaim} AA</span></div>
      <div class="bar" aria-hidden="true"><span style="width:${pct}%"></span></div></li>`;
  }).join("");
  return `<details${title === "Daily" ? " open" : ""}><summary>${esc(title)} ${meta}</summary><ol class="vault">${rows}</ol></details>`;
}

function renderVault() {
  const vault = ctx.getAccount()?.vault;
  const el = $("#tdVault");
  if (!vault) {
    el.innerHTML = `<h3 id="tdVaultTitle">Wizard's Vault</h3><p class="muted">Couldn't read your Wizard's Vault. It needs an API key; add one in Settings.</p>`;
    return;
  }
  const unclaimed = ["daily", "weekly", "special"].flatMap(k => vault[k]?.objectives || []).filter(o => !o.claimed && o.progress_current >= o.progress_complete).length;
  el.innerHTML = `<h3 id="tdVaultTitle">Wizard's Vault</h3>
    ${unclaimed ? `<p><span class="badge ok">${plural(unclaimed, "objective")} ready to claim</span></p>` : ""}
    ${vaultTrack("Daily", vault.daily)}${vaultTrack("Weekly", vault.weekly)}${vaultTrack("Special", vault.special)}`;
}

async function onClick(e) {
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    const ok = await copyText(copy.dataset.copy);
    ctx.toast(ok ? "Waypoint copied. Paste it in game chat and click it." : "Couldn't copy the waypoint.");
    return;
  }
  const fav = e.target.closest("[data-fav]");
  if (fav) {
    const favs = favourites();
    const name = fav.dataset.fav;
    if (favs.has(name)) favs.delete(name); else favs.add(name);
    ctx.saveSettings({ favourites: [...favs] });
    return;
  }
  if (e.target.closest("[data-starred]")) {
    onlyStarred = !onlyStarred;
    renderCats();
    renderEvents();
    return;
  }
  const cat = e.target.closest("[data-cat]");
  if (cat) {
    const hidden = new Set(ctx.settings.hiddenCats);
    const c = cat.dataset.cat;
    if (hidden.has(c)) hidden.delete(c); else hidden.add(c);
    ctx.saveSettings({ hiddenCats: [...hidden] });
  }
}

// A desktop alert a few minutes before each starred event, once per occurrence.
function checkAlerts() {
  const favs = favourites();
  if (!favs.size) return;
  const now = Date.now();
  const lead = (ctx.settings.alertLead || 5) * 60_000;
  for (const o of occurrences(data, now, now + lead)) {
    if (!favs.has(o.name) || o.start <= now || alerted.has(o.key)) continue;
    alerted.add(o.key);
    notify(`${o.name} in ${formatCountdown(o.start - now)}`, `${o.mapName}${o.chatlink ? ` · waypoint ${o.chatlink}` : ""}`);
  }
}
