// The Bank panel: the cleanup planner from gw2-bank-sorter.html, inside the overlay.
import { esc, coinHTML, plural } from "../core/format.js";
import { store } from "../core/api.js";
import { TAB_SIZE } from "../core/account.js";
import {
  analyze, ACTIONS, PLAN_ORDER, CATEGORY_NAMES, EQUIP, TP_KEEP,
  isTradeable, isUnlocked, needsFor, collText, tpUnit,
} from "../core/bank.js";
import { recipeUses, recipeCount } from "../core/recipes.js";
import { slotHTML, pipHTML, itemLine, readAt } from "./common.js";
import { copyText, isDesktop, markers } from "../platform.js";
import { calibrationKey, loadCalibration, slotCenter } from "../core/calibration.js";

const CAP_STORE = "gw2c.capacity";
const PREF_STORE = "gw2-bank-sorter.prefs.";

let root, ctx, $;
let account = null, result = null;
let ui = { view: "now", scope: "all", filter: null, selected: null };
// Saved per account: the always-keep list, ticked plan rows and collections the player isn't doing.
let prefs = { keep: new Map(), done: new Set(), ignore: new Map() };
let uses = null, usesState = "idle";   // recipe check for destroy and vendor candidates

const prefKey = (a = account) => PREF_STORE + (a.source === "example" ? "~example" : a.name);

// The always-keep list and ignored collections for any account, so the Macro panel plans with them too.
export function loadBankPrefs(a) {
  let p = {};
  try { p = JSON.parse(store.get(prefKey(a)) || "{}") || {}; } catch { p = {}; }
  return {
    keep: new Map(Object.entries(p.keep || {}).map(([id, v]) => [+id, v])),
    done: new Set(Array.isArray(p.done) ? p.done : []),
    ignore: new Map(Object.entries(p.ignore || {}).map(([id, name]) => [+id, name])),
  };
}
// A tick belongs to an item in a place, so it survives reloads and clears itself once the item is gone.
const doneKey = s => `${s.where}|${s.slot.id}`;

function loadPrefs() {
  prefs = loadBankPrefs(account);
}
function savePrefs() {
  store.set(prefKey(), JSON.stringify({ keep: Object.fromEntries(prefs.keep), done: [...prefs.done], ignore: Object.fromEntries(prefs.ignore) }));
}

const TEMPLATE = `
  <div class="sourcebar" id="bkSource"></div>
  <dl class="ledger" id="bkLedger"></dl>
  <section class="plan" aria-labelledby="bkPlanTitle">
    <div class="planhead">
      <div>
        <h2 class="section" id="bkPlanTitle">Cleanup plan</h2>
        <p>Work top to bottom and tick items off as you go. The API updates a few minutes after you change things in game, so press Refresh once you're done.</p>
        <div class="planprogress" id="bkProgress"></div>
      </div>
      <label class="capfield" for="bkCapacity">Material Storage size per item
        <select id="bkCapacity"></select>
      </label>
    </div>
    <p class="notice" id="bkCollNotice" hidden><strong>Still checking your collections.</strong> Hold off on selling, salvaging or destroying anything until this finishes.</p>
    <p class="notice" id="bkUsesNotice" hidden><strong>Checking crafting recipes.</strong> Anything a recipe uses will move out of the destroy list.</p>
    <div class="pgroups" id="bkGroups"></div>
    <div id="bkColls"></div>
    <div id="bkKeep"></div>
  </section>
  <section aria-labelledby="bkBankTitle">
    <div class="bankhead">
      <h2 class="section" id="bkBankTitle">Bank and bags</h2>
      <div class="bankctl">
        <label class="scopefield" id="bkScopeField" for="bkScope">Show <select id="bkScope"></select></label>
        <div class="seg" role="group" aria-label="Bank view">
          <button type="button" id="bkNow" aria-pressed="true">Now</button>
          <button type="button" id="bkAfter" aria-pressed="false">After cleanup</button>
        </div>
      </div>
    </div>
    <div class="filters" id="bkFilters" role="group" aria-label="Highlight slots by action"></div>
    <p class="afternote" id="bkAfterNote" hidden>Suggested bank layout once the plan is done. Every category gets its own tab when you have room; smaller groups share. Split stacks are shown merged.</p>
    <div class="storage" id="bkTabs"></div>
  </section>
  <aside class="inspector" id="bkInspector" aria-live="polite" aria-label="Slot details"></aside>`;

export default {
  id: "bank",
  title: "Bank",
  mount(el, context) {
    root = el;
    ctx = context;
    $ = sel => root.querySelector(sel);
    root.innerHTML = TEMPLATE;
    bindEvents();
    ctx.onAccount(a => setAccount(a));
    ctx.onSettings(() => { if (account) renderPlan(); });
    if (ctx.getAccount()) setAccount(ctx.getAccount());
    else $("#bkSource").innerHTML = `<p class="muted">Loading…</p>`;
  },
  hide() { closeInspector(); },
};

// Exposed for the Macro panel and "Show in game", which need the same analysis.
export function currentAnalysis() { return account && result ? { account, result, prefs } : null; }

function setAccount(a) {
  const sameAccount = account && a && account.name === a.name && account.source === a.source;
  account = a;
  if (!sameAccount) { ui = { view: "now", scope: "all", filter: null, selected: null }; uses = null; }
  loadPrefs();
  render();
  checkRecipes();
}

/* ---------- Recipe check ---------- */

async function checkRecipes() {
  const loaded = account;
  const ids = [...new Set(result.slots.filter(s => s.action === "destroy" || s.action === "vendor").map(s => s.slot.id))];
  if (!ids.length) { usesState = "done"; return; }
  usesState = "loading";
  renderPlan();
  try {
    const found = await recipeUses(ids);
    if (account !== loaded) return;
    uses = found;
  } catch { /* without recipe data the plan still stands, with the Mystic Forge caveat in the step text */ }
  usesState = "done";
  if (account === loaded) render();
}

/* ---------- Rendering ---------- */

function render() {
  if (!account) return;
  result = analyze(account, prefs, { recipeUses: uses });
  // Drop ticks for items that have since moved or been dealt with.
  const live = new Set(result.slots.filter(s => s.slot).map(doneKey));
  const before = prefs.done.size;
  for (const k of prefs.done) if (!live.has(k)) prefs.done.delete(k);
  if (prefs.done.size !== before) savePrefs();
  renderSource();
  renderLedger();
  renderCapacity();
  renderScope();
  renderBank();
  renderInspector();
  renderPlan();
}

function renderSource() {
  const el = $("#bkSource");
  const lines = [];
  if (account.unlocks === "missing") lines.push("Your key doesn't have the unlocks permission, so dyes, minis, recipes and skins aren't checked against what you own.");
  if (account.unlocks === "failed") lines.push("Couldn't read your unlocks this time, so they aren't checked.");
  if (account.chars === "missing") lines.push("Without the characters permission only the bank and shared slots are checked.");
  if (account.chars === "failed") lines.push("Couldn't read your characters' bags this time.");
  if (account.colls === "missing") lines.push("Without the progression permission, items your collections still need aren't protected.");
  if (account.colls === "failed") lines.push("Couldn't read your collections this time, so collection items aren't protected.");
  if (account.source === "example") {
    el.innerHTML = `<div><h2><span class="tag">Example</span>Example bank</h2>
      <p>Made-up contents so you can see how it works. Names, icons, prices and collections are live from the API.</p></div>
      <div class="sourceactions"><button class="btn small" type="button" data-goto-settings>Use my account</button></div>`;
  } else {
    el.innerHTML = `<div><h2>${esc(account.name)}</h2><p>Read at ${esc(readAt(account))}. ${plural(Math.ceil(account.bank.length / TAB_SIZE), "bank tab")}. ${esc(lines.join(" "))}</p></div>
      <div class="sourceactions"><button class="btn ghost small" type="button" id="bkRefresh">Refresh</button></div>`;
    $("#bkRefresh").addEventListener("click", () => ctx.refresh());
  }
}

function renderLedger() {
  const r = result;
  const b = r.bank;
  const after = b.filled - b.freed;
  const pctNow = b.total ? (b.filled / b.total) * 100 : 0;
  const pctAfter = b.total ? (after / b.total) * 100 : 0;
  const sellCount = r.slots.filter(s => s.action === "sell").length;
  const vendorCount = r.slots.filter(s => s.action === "vendor").length;
  const elsewhere = r.freed - b.freed;
  $("#bkLedger").innerHTML = `
    <div><dt>Bank slots used</dt><dd>${b.filled.toLocaleString()} <small>of ${b.total.toLocaleString()}</small></dd>
      <div class="meter" aria-hidden="true"><span style="width:${pctNow}%"></span><span style="width:${pctAfter}%"></span></div>
      <span class="sub">${after.toLocaleString()} after cleanup</span></div>
    <div><dt>Slots you can free</dt><dd>${r.freed.toLocaleString()}</dd><span class="sub">${b.freed.toLocaleString()} in the bank, ${elsewhere.toLocaleString()} elsewhere</span></div>
    <div><dt>Trading Post</dt><dd>${coinHTML(r.sell)}</dd><span class="sub">${plural(sellCount, "stack")}, after fees</span></div>
    <div><dt>Merchants</dt><dd>${coinHTML(r.vendor)}</dd><span class="sub">${plural(vendorCount, "stack")}</span></div>`;
}

function renderCapacity() {
  const opts = [];
  for (let n = 250; n <= 5000; n += 250) opts.push(n);
  if (!opts.includes(account.capacity)) opts.push(account.capacity);
  opts.sort((a, b) => a - b);
  $("#bkCapacity").innerHTML = opts.map(n => `<option value="${n}"${n === account.capacity ? " selected" : ""}>${n.toLocaleString()}${n === account.inferred && account.source !== "example" ? " (estimated)" : ""}</option>`).join("");
}

const inScope = s => ui.scope === "all" || s.cid === ui.scope;
const usedText = cells => `${cells.filter(s => s.slot).length} / ${cells.length}`;

function renderScope() {
  if (!account.containers.some(c => c.id === ui.scope)) ui.scope = "all";
  const todo = cid => result.byContainer.get(cid).filter(s => ACTIONS[s.action]).length;
  const label = c => c.kind === "bank" ? "Bank" : c.kind === "shared" ? "Shared inventory" : c.name;
  $("#bkScope").innerHTML = [`<option value="all">Everything (${result.slots.filter(s => ACTIONS[s.action]).length} to do)</option>`,
    ...account.containers.map(c => `<option value="${esc(c.id)}">${esc(label(c))} (${todo(c.id)} to do)</option>`)].join("");
  $("#bkScope").value = ui.scope;
  $("#bkScopeField").hidden = account.containers.length < 2 || ui.view !== "now";
}

function cellHTML(s) {
  if (!s.slot) return slotHTML({});
  const cls = [
    ui.filter && s.action !== ui.filter ? "dim" : "",
    ui.selected?.view === "now" && ui.selected.index === s.index ? "sel" : "",
    prefs.done.has(doneKey(s)) ? "done" : "",
  ].join(" ");
  return slotHTML({ item: s.item, slot: s.slot, action: s.action, classes: cls, attrs: `data-index="${s.index}"` });
}

function containerHTML(c) {
  const cells = result.byContainer.get(c.id);
  if (c.kind === "bank") {
    const tabs = [];
    for (let t = 0; t < cells.length; t += TAB_SIZE) {
      const tab = cells.slice(t, t + TAB_SIZE);
      tabs.push(`<div class="tab"><div class="tabhead"><h3>Tab ${t / TAB_SIZE + 1}</h3><span>${usedText(tab)}</span></div><div class="grid">${tab.map(cellHTML).join("")}</div></div>`);
    }
    return `<section><h3 class="loc-title">Bank <span>${usedText(cells)} slots used</span></h3><div class="tabs">${tabs.join("")}</div></section>`;
  }
  if (c.kind === "shared") {
    return `<section><h3 class="loc-title">Shared inventory <span>${usedText(cells)} slots used</span></h3>
      <div class="tabs"><div class="tab"><div class="grid">${cells.map(cellHTML).join("")}</div></div></div></section>`;
  }
  const bags = c.bags.map(b => {
    const bagCells = cells.slice(b.start, b.start + b.len);
    const name = account.items.get(b.id)?.name || "Bag";
    return `<div class="baglabel"><span>Bag ${b.n} · ${esc(name)}</span><span>${usedText(bagCells)}</span></div><div class="grid">${bagCells.map(cellHTML).join("")}</div>`;
  }).join("");
  return `<div class="tab"><div class="tabhead"><h3>${esc(c.name)}</h3><span>${usedText(cells)}</span></div>${bags || `<p class="baglabel">No bags</p>`}</div>`;
}

function renderBank() {
  const nowView = ui.view === "now";
  $("#bkNow").setAttribute("aria-pressed", String(nowView));
  $("#bkAfter").setAttribute("aria-pressed", String(!nowView));
  $("#bkFilters").hidden = !nowView;
  $("#bkAfterNote").hidden = nowView;
  $("#bkScopeField").hidden = account.containers.length < 2 || !nowView;

  if (nowView) {
    const visible = result.slots.filter(inScope);
    const counts = {};
    for (const s of visible) if (ACTIONS[s.action]) counts[s.action] = (counts[s.action] || 0) + 1;
    $("#bkFilters").innerHTML = `<button type="button" class="chip all" data-filter="" aria-pressed="${!ui.filter}">All <b>${visible.filter(s => s.slot).length}</b></button>` +
      PLAN_ORDER.filter(a => counts[a]).map(a => `<button type="button" class="chip" data-filter="${a}" aria-pressed="${ui.filter === a}">${pipHTML(a)}${ACTIONS[a].short} <b>${counts[a]}</b></button>`).join("");

    const shown = account.containers.filter(c => ui.scope === "all" || c.id === ui.scope);
    const chars = shown.filter(c => c.kind === "character");
    const sections = shown.filter(c => c.kind !== "character").map(containerHTML);
    if (chars.length) {
      const used = chars.reduce((n, c) => n + result.byContainer.get(c.id).filter(s => s.slot).length, 0);
      const total = chars.reduce((n, c) => n + c.cells.length, 0);
      sections.push(`<section><h3 class="loc-title">${chars.length > 1 ? "Characters" : "Character"} <span>${used} / ${total} bag slots used</span></h3><div class="tabs">${chars.map(containerHTML).join("")}</div></section>`);
    }
    $("#bkTabs").innerHTML = sections.join("");
  } else {
    $("#bkTabs").innerHTML = `<div class="tabs">` + result.layout.map((tab, ti) => {
      const names = tab.parts.map(p => CATEGORY_NAMES[p.cat]).join(" · ") || "Empty";
      let html = "";
      for (let i = 0; i < TAB_SIZE; i++) {
        const e = tab.entries[i];
        if (!e) { html += slotHTML({}); continue; }
        const sel = ui.selected?.view === "after" && ui.selected.tab === ti && ui.selected.pos === i ? "sel" : "";
        html += slotHTML({ item: e.item, slot: e.slot, count: e.count, classes: sel, attrs: `data-tab="${ti}" data-pos="${i}"` });
      }
      return `<div class="tab"><div class="tabhead"><h3>Tab ${ti + 1}</h3><span>${esc(names)}</span></div><div class="grid">${html}</div></div>`;
    }).join("") + `</div>`;
  }
}

function bindingText(slot) {
  if (slot.binding === "Character") return `Soulbound${slot.bound_to ? ` to ${slot.bound_to}` : ""}`;
  if (slot.binding === "Account") return "Account bound";
  return "";
}

function closeInspector() {
  if (!ui.selected) return;
  ui.selected = null;
  renderBank();
  renderInspector();
}

function renderInspector() {
  const el = $("#bkInspector");
  const sel = ui.selected;
  el.classList.toggle("open", !!sel);
  if (!sel) { el.innerHTML = ""; return; }

  let s, item, slot, count, verdict, extraFacts = [];
  if (sel.view === "now") {
    s = result.slots[sel.index];
    if (!s || !s.slot) { ui.selected = null; return renderInspector(); }
    ({ item, slot } = s);
    count = slot.count || 1;
    extraFacts.push(["Where", s.where]);
    const others = result.slots.filter(o => o.slot && o.index !== s.index && o.slot.id === slot.id);
    if (others.length) {
      const list = others.slice(0, 4).map(o => `${o.where}${o.slot.count > 1 ? ` (${o.slot.count.toLocaleString()})` : ""}`);
      if (others.length > 4) list.push(`${others.length - 4} more`);
      extraFacts.push(["Also in", list.join("; ")]);
    }
    const title = ACTIONS[s.action] ? `${ACTIONS[s.action].title}${s.partial ? ` (${s.deposit.toLocaleString()} of ${count.toLocaleString()})` : ""}` : "Keep";
    verdict = `<div class="verdict">${ACTIONS[s.action] ? pipHTML(s.action) : "<span></span>"}<div><strong>${esc(title)}</strong></div>
      <p>${esc(s.reason || "")}</p>${s.alt ? `<p class="alt">${esc(s.alt)}</p>` : ""}</div>`;
  } else {
    const e = result.layout[sel.tab]?.entries[sel.pos];
    if (!e) { ui.selected = null; return renderInspector(); }
    ({ item, slot, count } = e);
    extraFacts.push(["Goes to", `Tab ${sel.tab + 1}, slot ${sel.pos + 1}`]);
    extraFacts.push(["Now in", e.from.map(f => f.where).join("; ")]);
    verdict = `<div class="verdict"><span></span><div><strong>${esc(CATEGORY_NAMES[e.cat])}</strong></div><p>${e.from.length > 1 ? `Merged from ${e.from.length} stacks.` : "Kept in the bank."}</p></div>`;
  }

  const price = item && isTradeable(slot, item) ? account.prices.get(item.id) : null;
  const facts = [...extraFacts];
  if (count > 1) facts.push(["Count", count.toLocaleString()]);
  const bind = bindingText(slot);
  if (bind) facts.push(["Binding", esc(bind)]);
  if (slot.charges) facts.push(["Charges", slot.charges]);
  const owned = isUnlocked(item, account.owned);
  if (owned != null) {
    facts.push(EQUIP.has(item.type)
      ? ["Skin", owned ? "In your wardrobe" : "Not in your wardrobe yet"]
      : ["Unlocked", owned ? "Yes, your account has it" : "Not yet"]);
  }
  // Every unfinished collection this item, its skin or its mini still counts toward.
  const need = (kind, id) => needsFor(account.needs, prefs.ignore, kind, id);
  const colls = item ? [...need("items", item.id), ...need("skins", item.default_skin), ...need("minis", item.details?.minipet_id)]
    .filter((c, i, all) => all.findIndex(o => o.id === c.id) === i) : [];
  if (colls.length) {
    const names = colls.slice(0, 4).map(c => c.name);
    if (colls.length > 4) names.push(`${colls.length - 4} more`);
    facts.push(["Collections", esc(names.join("; "))]);
  }
  if (account.storable.has(slot.id)) facts.push(["In storage", `${(account.storage.get(slot.id) || 0).toLocaleString()} of ${account.capacity.toLocaleString()}`]);
  const upgrades = [...(slot.upgrades || []), ...(slot.infusions || [])].map(id => account.items.get(id)?.name || `Item ${id}`);
  if (upgrades.length) facts.push(["Upgrades", esc(upgrades.join(", "))]);
  if (price && tpUnit(price)) {
    facts.push(["Sell now", `${coinHTML(Math.floor(price.now * TP_KEEP))} each`]);
    if (price.list) facts.push(["Listing", `${coinHTML(Math.floor(price.list * TP_KEEP))} each`]);
  } else if (item) {
    facts.push(["Trading Post", isTradeable(slot, item) ? "No current orders" : "Can't be traded"]);
  }
  if (item && item.vendor_value && !(item.flags || []).includes("NoSell")) facts.push(["Merchant", `${coinHTML(item.vendor_value)} each`]);
  facts.push(["Used to craft", `<span id="bkUsedIn" class="muted">Checking…</span>`]);

  const plainText = new Set(["Where", "Also in", "Goes to", "Now in"]);
  const factsHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${plainText.has(k) ? esc(v) : v}</dd>`).join("");
  const wiki = item ? `<a href="https://wiki.guildwars2.com/index.php?search=${encodeURIComponent(item.name)}" target="_blank" rel="noopener">Wiki</a>` : "";
  const chat = item?.chat_link ? `<div class="chatrow"><code>${esc(item.chat_link)}</code><button type="button" class="btn ghost small" id="bkCopyChat">Copy chat code</button>${wiki}</div>` : wiki;
  const keepBtn = item ? `<div class="chatrow"><button type="button" class="btn ghost small" id="bkKeepToggle">${prefs.keep.has(item.id) ? "Remove from always-keep" : "Always keep this item"}</button>${colls.length
    ? `<button type="button" class="btn ghost small" id="bkIgnoreColls">${colls.length > 1 ? "Not doing these collections" : "Not doing this collection"}</button>` : ""}</div>` : "";

  el.innerHTML = `
    <button type="button" class="btn ghost small ins-close" id="bkCloseIns">Close</button>
    <div class="ins-top">${slotHTML({ item, slot, count, tag: "div" })}
      <div><h3 class="rname r-${esc(item?.rarity || "Basic")}">${esc(item ? item.name : `Unknown item ${slot.id}`)}</h3><p>${esc(itemLine(item, slot))}</p></div></div>
    ${verdict}
    <dl class="facts">${factsHTML}</dl>
    ${keepBtn}
    ${chat}`;

  $("#bkCloseIns").addEventListener("click", closeInspector);
  $("#bkKeepToggle")?.addEventListener("click", () => setKeep(item, !prefs.keep.has(item.id)));
  $("#bkIgnoreColls")?.addEventListener("click", () => setIgnored(colls, true));
  $("#bkCopyChat")?.addEventListener("click", async e => {
    const btn = e.currentTarget;
    btn.textContent = (await copyText(item.chat_link)) ? "Copied" : "Couldn't copy";
  });
  if (item) fillUsedIn(item.id);
}

// "What is this for?": filled in once the recipe search answers.
async function fillUsedIn(id) {
  let names = [];
  try { names = (await recipeUses([id])).get(id) || []; } catch { names = null; }
  const el = $("#bkUsedIn");
  if (!el) return;
  el.classList.remove("muted");
  if (names === null) el.textContent = "Couldn't check right now.";
  else if (!names.length) el.textContent = "No crafting recipes. The API doesn't list Mystic Forge recipes.";
  else {
    const total = recipeCount(id) ?? names.length;
    el.textContent = total > 6 ? `${names.slice(0, 6).join(", ")} and ${plural(total - 6, "more recipe")}` : names.join(", ");
  }
}

const planRows = () => result.slots.filter(s => ACTIONS[s.action] && inScope(s));

function renderProgress() {
  const rows = planRows();
  const done = rows.filter(s => prefs.done.has(doneKey(s))).length;
  $("#bkProgress").innerHTML = rows.length
    ? `<span><b>${done}</b> of ${rows.length} done</span>${done ? `<button type="button" class="linkish" id="bkClearDone">Clear ticks</button>` : ""}`
    : "";
  $("#bkClearDone")?.addEventListener("click", () => {
    const cleared = rows.map(doneKey).filter(k => prefs.done.has(k));
    cleared.forEach(k => prefs.done.delete(k));
    savePrefs();
    renderBank();
    renderPlan();
    ctx.toast(`Cleared ${plural(cleared.length, "tick")}.`, () => { cleared.forEach(k => prefs.done.add(k)); savePrefs(); renderBank(); renderPlan(); });
  });
}

function renderKeepList() {
  const wasOpen = $("#bkKeep details")?.open;
  if (!prefs.keep.size) { $("#bkKeep").innerHTML = ""; return; }
  const entries = [...prefs.keep.entries()].sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""));
  $("#bkKeep").innerHTML = `<details class="keeplist"${wasOpen ? " open" : ""}>
    <summary>Always-keep list <span>(${prefs.keep.size})</span></summary>
    <ul>${entries.map(([id, v]) => `<li>${v.icon ? `<img src="${esc(v.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span>${esc(v.name || `Item ${id}`)}</span><button type="button" data-unkeep="${id}" aria-label="Remove ${esc(v.name || `item ${id}`)} from the always-keep list">Remove</button></li>`).join("")}</ul>
    <p>These are never suggested for selling, salvaging, using or destroying. They can still be sent to Material Storage or merged into one stack.</p>
  </details>`;
}

function renderCollList() {
  const wasOpen = $("#bkColls details")?.open;
  const rows = result.slots.filter(s => s.forCollections && inScope(s));
  if (!rows.length && !prefs.ignore.size) { $("#bkColls").innerHTML = ""; return; }
  const items = rows.map(s => {
    const name = s.item ? s.item.name : `Unknown item ${s.slot.id}`;
    const count = s.slot.count > 1 ? ` ×${s.slot.count.toLocaleString()}` : "";
    return `<li class="collrow">${slotHTML({ item: s.item, slot: s.slot, tag: "div" })}
      <div class="ctext"><button type="button" class="pname rname r-${esc(s.item?.rarity || "Basic")}" data-goto="${s.index}">${esc(name)}${esc(count)}</button><span class="preason">${esc(s.reason)}</span><span class="ploc">${esc(s.where)}</span></div>
      <button type="button" class="pkeep" data-ignore="${s.index}">${s.forCollections.length > 1 ? "Not doing these" : "Not doing this"}</button></li>`;
  }).join("");
  const ignored = [...prefs.ignore.entries()].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<li><span>${esc(name)}</span><button type="button" data-unignore="${id}" aria-label="Stop ignoring ${esc(name)}">Stop ignoring</button></li>`).join("");
  $("#bkColls").innerHTML = `<details class="keeplist"${wasOpen ? " open" : ""}>
    <summary>Kept for collections <span>(${rows.length})</span></summary>
    <p>Your unfinished collections still need these, so the plan leaves them alone. Not doing a collection? Ignore it and its items go back into the plan.</p>
    ${rows.length ? `<ol class="collrows">${items}</ol>` : ""}
    ${ignored ? `<p>Collections you're ignoring:</p><ul>${ignored}</ul>` : ""}
  </details>`;
}

function renderPlan() {
  if (!result) return;
  $("#bkCollNotice").hidden = account.colls !== "loading";
  $("#bkUsesNotice").hidden = usesState !== "loading";
  renderProgress();
  renderCollList();
  renderKeepList();
  const rows = planRows();
  const groups = PLAN_ORDER.map(a => ({ a, rows: rows.filter(s => s.action === a) })).filter(g => g.rows.length);
  if (!groups.length) {
    $("#bkGroups").innerHTML = `<div class="empty-plan">Nothing to clean up here. Every slot holds something worth keeping, and nothing can go to Material Storage.</div>`;
    return;
  }
  const highValue = ctx.settings.highValue;
  // With the bank marked in the Macro tab, bank rows can point at their slot in the game.
  const calib = isDesktop ? loadCalibration(calibrationKey(screen.width * devicePixelRatio, screen.height * devicePixelRatio)) : null;
  const onScreen = s => calib?.pitch && s.kind === "bank" && slotCenter(calib, (s.tab - 1) * TAB_SIZE + (s.pos - 1));
  $("#bkGroups").innerHTML = groups.map(({ a, rows }) => {
    const freed = rows.filter(s => !s.partial).length;
    const value = a === "sell" || a === "vendor" ? rows.reduce((n, s) => n + (s.value || 0), 0) : 0;
    const meta = `${plural(rows.length, "slot")}${freed !== rows.length ? `, frees ${freed}` : ""}${value ? ` · ${coinHTML(value)}` : ""}`;
    const items = rows.map(s => {
      const done = prefs.done.has(doneKey(s));
      const name = s.item ? s.item.name : `Unknown item ${s.slot.id}`;
      const count = s.slot.count > 1 ? ` ×${s.slot.count.toLocaleString()}` : "";
      const val = (a === "sell" || a === "vendor" || a === "salvage") && s.value ? coinHTML(s.value) : (a === "deposit" ? `${s.deposit.toLocaleString()} in` : "");
      // Getting rid of something valuable deserves a second look.
      const worth = Math.max(s.value || 0, s.price ? Math.floor(tpUnit(s.price) * (s.slot.count || 1) * TP_KEEP) : 0);
      const high = ["sell", "vendor", "salvage", "destroy"].includes(a) && highValue > 0 && worth >= highValue
        ? ` <span class="badge warn" title="Worth at least ${esc(String(Math.round(highValue / 10000)))} gold. Double-check before you get rid of it.">High value</span>` : "";
      // Deposits and stacks lose nothing, so they don't need an always-keep button.
      const keepBtn = (s.item && a !== "deposit" && a !== "stack"
        ? `<button type="button" class="pkeep" data-keep="${s.item.id}" aria-label="Always keep ${esc(name)}">Always keep</button>` : "")
        + (onScreen(s) ? `<button type="button" class="pkeep" data-show="${s.index}" aria-label="Show ${esc(name)} in the game">Show in game</button>` : "");
      return `<li class="prow${done ? " done" : ""}">
        <input type="checkbox" data-done="${s.index}"${done ? " checked" : ""} aria-label="Done: ${esc(name)}">
        ${slotHTML({ item: s.item, slot: s.slot, tag: "div" })}
        <div class="ptext"><button type="button" class="pname rname r-${esc(s.item?.rarity || "Basic")}" data-goto="${s.index}">${esc(name)}${esc(count)}</button>${high}<span class="preason">${esc(s.reason || "")}${s.alt ? ` ${esc(s.alt)}` : ""}</span></div>
        <span class="ploc">${esc(s.where)}</span>
        <span class="pval">${val}</span>
        ${keepBtn}
      </li>`;
    }).join("");
    return `<section class="pgroup" aria-label="${esc(ACTIONS[a].title)}">
      <div class="pghead">${pipHTML(a)}<h3>${esc(ACTIONS[a].title)}</h3><span class="meta">${meta}</span><p class="step">${esc(ACTIONS[a].step)}</p></div>
      <ol class="prows">${items}</ol></section>`;
  }).join("");
}

/* ---------- Actions ---------- */

function setIgnored(list, on, quiet = false) {
  for (const c of list) {
    if (on) prefs.ignore.set(c.id, c.name); else prefs.ignore.delete(c.id);
  }
  savePrefs();
  render();
  if (!quiet) {
    ctx.toast(on ? `Ignoring ${collText(list, false)}. ${list.length > 1 ? "Their" : "Its"} items are back in the plan.`
                 : `${collText(list)} ${list.length > 1 ? "are" : "is"} protected again.`,
      () => setIgnored(list, !on, true));
  }
}

function setKeep(item, on, quiet = false) {
  const saved = prefs.keep.get(item.id) || { name: item.name, icon: item.icon || "" };
  if (on) prefs.keep.set(item.id, saved); else prefs.keep.delete(item.id);
  savePrefs();
  render();
  if (!quiet) {
    ctx.toast(on ? `${saved.name} will always be kept.` : `${saved.name} is off your always-keep list.`,
      () => setKeep({ id: item.id, ...saved }, !on, true));
  }
}

function gotoSlot(index) {
  ui.view = "now";
  ui.filter = null;
  ui.selected = { view: "now", index };
  renderBank();
  renderInspector();
  root.querySelector(`#bkTabs [data-index="${index}"]`)?.scrollIntoView({ block: "center" });
}

function bindEvents() {
  root.addEventListener("click", e => {
    if (e.target.closest("[data-goto-settings]")) ctx.showTab("settings");
  });
  $("#bkNow").addEventListener("click", () => { ui.view = "now"; ui.selected = null; renderBank(); renderInspector(); });
  $("#bkAfter").addEventListener("click", () => { ui.view = "after"; ui.selected = null; renderBank(); renderInspector(); });
  $("#bkScope").addEventListener("change", e => {
    ui.scope = e.target.value;
    ui.filter = null;
    if (ui.selected?.view === "now" && !inScope(result.slots[ui.selected.index])) ui.selected = null;
    renderBank();
    renderInspector();
    renderPlan();
  });
  $("#bkFilters").addEventListener("click", e => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    const f = chip.dataset.filter || null;
    ui.filter = ui.filter === f ? null : f;
    renderBank();
  });
  $("#bkTabs").addEventListener("click", e => {
    const cell = e.target.closest("button.slot");
    if (!cell) return;
    if (cell.dataset.index != null) ui.selected = { view: "now", index: +cell.dataset.index };
    else ui.selected = { view: "after", tab: +cell.dataset.tab, pos: +cell.dataset.pos };
    renderBank();
    renderInspector();
  });
  $("#bkGroups").addEventListener("change", e => {
    const box = e.target.closest("[data-done]");
    if (!box) return;
    const key = doneKey(result.slots[+box.dataset.done]);
    if (box.checked) prefs.done.add(key); else prefs.done.delete(key);
    savePrefs();
    box.closest(".prow").classList.toggle("done", box.checked);
    renderProgress();
    if (ui.view === "now") renderBank();
  });
  $("#bkGroups").addEventListener("click", e => {
    const show = e.target.closest("[data-show]");
    if (show) {
      const s = result.slots[+show.dataset.show];
      const calib = loadCalibration(calibrationKey(screen.width * devicePixelRatio, screen.height * devicePixelRatio));
      const c = slotCenter(calib, (s.tab - 1) * TAB_SIZE + (s.pos - 1));
      if (c) markers.show([{ x: c[0], y: c[1], size: Math.round(calib.pitch), label: s.item?.name || "" }], { hideAfter: 6000 });
      return;
    }
    const keep = e.target.closest("[data-keep]");
    if (keep) {
      const item = account.items.get(+keep.dataset.keep);
      if (item) setKeep(item, true);
      return;
    }
    const go = e.target.closest("[data-goto]");
    if (go) gotoSlot(+go.dataset.goto);
  });
  $("#bkColls").addEventListener("click", e => {
    const go = e.target.closest("[data-goto]");
    if (go) return gotoSlot(+go.dataset.goto);
    const ignore = e.target.closest("[data-ignore]");
    if (ignore) return setIgnored(result.slots[+ignore.dataset.ignore].forCollections, true);
    const un = e.target.closest("[data-unignore]");
    if (un) {
      const id = +un.dataset.unignore;
      setIgnored([{ id, name: prefs.ignore.get(id) }], false);
    }
  });
  $("#bkCapacity").addEventListener("change", e => {
    account.capacity = +e.target.value;
    if (account.source === "account") store.set(CAP_STORE, String(account.capacity));
    render();
  });
  $("#bkKeep").addEventListener("click", e => {
    const btn = e.target.closest("[data-unkeep]");
    if (!btn) return;
    const id = +btn.dataset.unkeep;
    setKeep({ id, ...prefs.keep.get(id) }, false);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && ui.selected && !root.hidden) closeInspector();
  });
}
