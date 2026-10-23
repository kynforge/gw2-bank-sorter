// The Builds panel: a character's real stats from the API, and stat sets that suit a goal better.
import { esc } from "../core/format.js";
import { getJSON, getMany, store } from "../core/api.js";
import { gearAttributes, derived, addAttrs, BASE, DEFAULT_ASSUMPTIONS, SLOT_LABELS } from "../core/stats.js";
import { GOALS, CONDITIONS, optimize, score, hybridRefs } from "../core/optimizer.js";
import { parseEliteInsights } from "../core/eilog.js";

const DATA_STORE = "gw2c.buildsdata";
const DATA_VERSION = 1;

let root, ctx, $;
let catalog = null;           // { itemstats: Map, refs: Map("Armor:Helm" -> legendary item) }
let catalogState = "idle";
let memo = { key: null, best: null };   // the last optimization and what it was for
// Boon builds usually get the rest of their duration from traits and food, so 50% from gear is a sensible start.
let state = { character: null, weaponSet: "A", goal: "power", condition: "bleeding", weight: 0.5, minBoon: 50, assumptions: { ...DEFAULT_ASSUMPTIONS }, log: null };

export default {
  id: "builds",
  title: "Builds",
  mount(el, context) {
    root = el;
    ctx = context;
    $ = sel => root.querySelector(sel);
    root.innerHTML = `
      <div><h2 class="section">Builds</h2>
        <p class="lead">Your character's stats from the API, and which stat sets would suit a goal better. The numbers come from ArenaNet's item data; the damage scores are estimates.</p></div>
      <div id="bdBody"></div>`;
    root.addEventListener("change", onChange);
    root.addEventListener("click", e => { if (e.target.closest("[data-goto-settings]")) ctx.showTab("settings"); });
    ctx.onAccount(() => { state.character = null; render(); });
  },
  show() { ensureCatalog(); render(); },
};

/* ---------- Reference data ---------- */

async function ensureCatalog() {
  if (catalog || catalogState === "loading") return;
  catalogState = "loading";
  try {
    const build = await getJSON("/build").then(b => b?.id ?? null, () => null);
    let cached = null;
    try { cached = JSON.parse(store.get(DATA_STORE) || "null"); } catch { cached = null; }
    if (!(cached && cached.v === DATA_VERSION && build && cached.build === build)) {
      const itemstats = await getJSON("/itemstats", { ids: "all", lang: "en" });
      const ids = ((await getJSON("/legendaryarmory", { ids: "all" })) || []).map(a => a.id);
      const legendaries = await getMany("/items", ids);
      // One legendary per slot type: its stat choices and attribute adjustment stand for ascended gear in that slot.
      const refs = {};
      for (const it of legendaries) {
        const key = refKey(it);
        if (key && it.details?.stat_choices?.length && !refs[key]) refs[key] = { id: it.id, adj: it.details.attribute_adjustment, choices: it.details.stat_choices };
      }
      cached = { v: DATA_VERSION, build, itemstats, refs };
      if (build) store.set(DATA_STORE, JSON.stringify(cached));
    }
    catalog = { itemstats: new Map(cached.itemstats.map(s => [s.id, s])), refs: new Map(Object.entries(cached.refs)) };
    catalogState = "ready";
  } catch {
    catalogState = "failed";
  }
  render();
}

function refKey(item) {
  if (!item) return null;
  if (item.type === "Back") return "Back";
  if (["Armor", "Weapon", "Trinket"].includes(item.type) && item.details?.type) return `${item.type}:${item.details.type}`;
  return null;
}

/* ---------- Rendering ---------- */

const fmt = (n, digits = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const statName = id => catalog?.itemstats.get(id)?.name?.replace(/'s$/, "") || "—";

function render() {
  if (!root || root.hidden) return;
  const account = ctx.getAccount();
  const body = $("#bdBody");
  const chars = (account?.characters || []).filter(c => c.equipment?.length);
  if (!account) { body.innerHTML = `<p class="muted">Loading…</p>`; return; }
  if (!chars.length) {
    body.innerHTML = `<div class="empty-plan">No equipment to read. The API key needs the characters and builds permissions. <button type="button" class="linkish" data-goto-settings>Open Settings</button></div>`;
    return;
  }
  if (catalogState === "loading" || catalogState === "idle") { body.innerHTML = `<p class="muted">Loading stat data from the API…</p>`; return; }
  if (catalogState === "failed") { body.innerHTML = `<div class="empty-plan">Couldn't load stat data from the API. Check your connection and open this tab again.</div>`; catalogState = "idle"; return; }

  if (!chars.some(c => c.name === state.character)) state.character = chars[0].name;
  const ch = chars.find(c => c.name === state.character);
  const g = gearAttributes(ch.equipment, { items: account.items, itemstats: catalog.itemstats }, { weaponSet: state.weaponSet });
  const assumptions = {
    ...state.assumptions,
    condDuration: (state.assumptions.condDuration || 0) + g.durations.condDuration,
    boonDuration: (state.assumptions.boonDuration || 0) + g.durations.boonDuration,
  };
  const now = derived(addAttrs(BASE, g.attrs), assumptions, ch.profession);
  const goal = GOALS.find(x => x.id === state.goal);
  const opts = { condition: state.condition, weight: state.weight, minBoon: state.minBoon };

  // Gear slots the optimizer may change: each piece's own choices if it has them, otherwise its slot's legendary.
  const pieces = g.sources.filter(s => !["Runes", "Upgrades"].includes(s.slot));
  const fixed = g.sources.filter(s => s.slot === "Runes" || s.slot === "Upgrades").reduce((a, s) => addAttrs(a, s.attrs), { ...BASE });
  const wanted = new Set(goal.stats);
  const slots = [];
  for (const p of pieces) {
    const item = account.items.get(p.itemId);
    const ref = catalog.refs.get(refKey(item));
    const adj = ref?.adj ?? p.adj;
    const choiceIds = p.choices?.length ? p.choices : ref?.choices || [];
    const choices = choiceIds.map(id => catalog.itemstats.get(id)).filter(s => s && wanted.has(s.name));
    if (adj && choices.length) slots.push({ slot: p.slot, adj, choices });
  }
  const memoKey = JSON.stringify([ch.name, state.weaponSet, state.goal, opts, assumptions, slots.map(sl => [sl.slot, sl.adj, sl.choices.map(c => c.id)]), fixed]);
  if (memo.key !== memoKey) memo = { key: memoKey, best: slots.length ? optimize({ slots, base: fixed, goal: state.goal, opts, assumptions }) : null };
  const best = memo.best;
  const bestStats = best ? derived(best.attrs, assumptions, ch.profession) : null;
  const refs = hybridRefs(fixed, assumptions, state.condition);
  const nowScore = score(now, state.goal, { ...opts, refs });
  const bestScore = best ? score(best.derived, state.goal, { ...opts, refs }) : nowScore;
  const gain = nowScore > 0 ? ((bestScore - nowScore) / nowScore) * 100 : 0;

  const changes = pieces.filter(p => best?.picks[p.slot] != null && statName(best.picks[p.slot]) !== statName(p.statId));
  // Each goal's headline: the number that goal is about.
  const more = gain > 0.05 ? `about <b>${fmt(gain, 1)}% more</b> damage by this estimate` : "about the same damage by this estimate";
  const headline = !bestStats ? "" : {
    healer: `Healing Power ${fmt(now.healing)} → <b>${fmt(bestStats.healing)}</b>, boon duration ${fmt(now.boonDuration, 1)}% → <b>${fmt(bestStats.boonDuration, 1)}%</b>`,
    boonDps: `Boon duration ${fmt(now.boonDuration, 1)}% → <b>${fmt(bestStats.boonDuration, 1)}%</b>, ${more}`,
  }[state.goal] || more.charAt(0).toUpperCase() + more.slice(1);
  body.innerHTML = `
    <div class="card">
      <div class="row">
        <label class="field">Character <select id="bdChar">${chars.map(c => `<option${c.name === ch.name ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label class="field">Weapons <select id="bdSet"><option value="A"${state.weaponSet === "A" ? " selected" : ""}>Set 1</option><option value="B"${state.weaponSet === "B" ? " selected" : ""}>Set 2</option></select></label>
      </div>
      <p class="muted">${esc([ch.profession, ch.equipmentTab ? `equipment tab "${ch.equipmentTab}"` : ""].filter(Boolean).join(" · "))}</p>
      ${g.missing.length ? `<p class="notice">Nothing equipped in ${esc(g.missing.map(s => SLOT_LABELS[s] || s).join(", "))}. Those slots are left out.</p>` : ""}
    </div>

    <div class="card">
      <h3>Goal</h3>
      <div class="row">
        <label class="field">Optimize for <select id="bdGoal">${GOALS.map(x => `<option value="${x.id}"${x.id === state.goal ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        ${["condi", "hybrid"].includes(state.goal) ? `<label class="field">Main condition <select id="bdCond">${Object.entries(CONDITIONS).map(([id, c]) => `<option value="${id}"${id === state.condition ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
        ${state.goal === "hybrid" ? `<label class="field">Power share <input type="range" id="bdWeight" min="0" max="1" step="0.1" value="${state.weight}"></label>` : ""}
        ${["boonDps", "healer"].includes(state.goal) ? `<label class="field">Boon duration at least (%) <input type="number" id="bdMinBoon" min="0" max="100" step="5" value="${state.minBoon}"></label>` : ""}
      </div>
    </div>

    <details class="card">
      <summary><b>Assumptions</b> <span class="muted">${state.log ? `from your log of ${esc(state.log.fight || state.log.name)}` : "Might, Fury and food"}</span></summary>
      <div class="row">
        <label class="field">Might stacks <input type="number" id="bdMight" min="0" max="25" step="0.5" value="${state.assumptions.might}"></label>
        <label class="field">Fury uptime (%) <input type="number" id="bdFury" min="0" max="100" step="1" value="${fmt(state.assumptions.fury * 100)}"></label>
        <label class="field">Extra crit chance (%) <input type="number" id="bdCrit" min="0" max="100" step="1" value="${state.assumptions.extraCrit}"></label>
        <label class="field">Extra condition duration (%) <input type="number" id="bdCondDur" min="0" max="100" step="5" value="${state.assumptions.condDuration}"></label>
        <label class="field">Extra boon duration (%) <input type="number" id="bdBoonDur" min="0" max="100" step="5" value="${state.assumptions.boonDuration}"></label>
      </div>
      <label class="field">Use real numbers from a fight: Elite Insights JSON log <input type="file" id="bdLog" accept=".json,application/json"></label>
      <p class="muted">Turn on JSON output in Elite Insights, parse one of your ArcDPS logs, and pick the file. Might and Fury come from that fight.${state.log ? ` Read ${esc(state.log.name)}: ${fmt(state.log.might, 1)} Might, ${fmt(state.log.fury * 100)}% Fury.` : ""}</p>
    </details>

    <div class="card">
      <h3>Stats</h3>
      <table class="stattable">
        <thead><tr><th></th><th>Now</th>${best ? "<th>Suggested</th>" : ""}</tr></thead>
        <tbody>${[
          ["Power", n => fmt(n.power)],
          ["Crit chance", n => `${fmt(n.critChance, 1)}%`],
          ["Crit damage", n => `${fmt(n.critDamage, 1)}%`],
          ["Condition Damage", n => fmt(n.condiDamage)],
          ["Condition duration", n => `${fmt(n.condDuration, 1)}%`],
          ["Boon duration", n => `${fmt(n.boonDuration, 1)}%`],
          ["Healing Power", n => fmt(n.healing)],
          ["Toughness", n => fmt(n.toughness)],
          ...(now.health ? [["Health", n => fmt(n.health)]] : []),
        ].map(([label, f]) => `<tr><th>${label}</th><td>${f(now)}</td>${bestStats ? `<td>${f(bestStats)}</td>` : ""}</tr>`).join("")}</tbody>
      </table>
      <p class="muted">Includes ${esc(state.assumptions.might ? `${fmt(state.assumptions.might, 1)} Might` : "no Might")} and ${esc(state.assumptions.fury ? `${fmt(state.assumptions.fury * 100)}% Fury` : "no Fury")}${g.durations.condDuration || g.durations.boonDuration ? ", plus duration from your runes" : ""}.</p>
    </div>

    <div class="card">
      <h3>Suggested stat sets</h3>
      ${!best ? `<p class="muted">No stat choices fit this goal for your gear.</p>`
        : !changes.length ? `<p>Your gear already fits this goal. Nothing to change.</p>`
        : `<p>${headline}.${best.unmet ? ` <span class="badge warn">Gear and runes alone can't reach ${state.minBoon}% boon duration</span>` : ""}</p>
          <ol class="changes">${changes.map(p => `<li><div><b>${esc(SLOT_LABELS[p.slot] || p.slot)}</b> <span class="muted">${esc(p.label)}</span></div>
            <div>${esc(statName(p.statId))} → <b>${esc(statName(best.picks[p.slot]))}</b></div>
            <span class="badge ${p.legendary ? "ok" : "warn"}">${p.legendary ? "Free: legendary, swap stats" : "Needs new gear"}</span></li>`).join("")}</ol>`}
      <p class="muted">Not modelled: traits, sigil procs and skill coefficients. Check a build site before buying gear. Runes, infusions and food stay as they are.</p>
    </div>`;
}

/* ---------- Inputs ---------- */

async function onChange(e) {
  const t = e.target;
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  switch (t.id) {
    case "bdChar": state.character = t.value; state.log = null; break;
    case "bdSet": state.weaponSet = t.value; break;
    case "bdGoal": state.goal = t.value; break;
    case "bdCond": state.condition = t.value; break;
    case "bdWeight": state.weight = num(t.value, 0, 1); break;
    case "bdMinBoon": state.minBoon = num(t.value, 0, 100); break;
    case "bdMight": state.assumptions.might = num(t.value, 0, 25); break;
    case "bdFury": state.assumptions.fury = num(t.value, 0, 100) / 100; break;
    case "bdCrit": state.assumptions.extraCrit = num(t.value, 0, 100); break;
    case "bdCondDur": state.assumptions.condDuration = num(t.value, 0, 100); break;
    case "bdBoonDur": state.assumptions.boonDuration = num(t.value, 0, 100); break;
    case "bdLog": {
      const file = t.files?.[0];
      if (!file) return;
      try {
        const log = parseEliteInsights(JSON.parse(await file.text()), state.character);
        state.log = log;
        state.assumptions.might = Math.min(25, log.might);
        state.assumptions.fury = log.fury;
        ctx.toast(`Read ${log.name}: ${fmt(log.might, 1)} Might and ${fmt(log.fury * 100)}% Fury.`);
      } catch (err) {
        ctx.toast(err instanceof SyntaxError ? "That file isn't valid JSON." : err.message);
      }
      break;
    }
    default: return;
  }
  render();
  // Keep focus on the control that changed, since render() replaces the panel.
  if (t.id) root.querySelector(`#${t.id}`)?.focus({ preventScroll: true });
}
