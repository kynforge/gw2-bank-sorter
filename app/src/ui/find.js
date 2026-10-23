// The Find panel: where is this item, and which items are spread across characters.
import { esc, coinHTML, plural } from "../core/format.js";
import { buildIndex, search, scattered } from "../core/finder.js";
import { TP_KEEP, tpUnit } from "../core/bank.js";
import { slotHTML, iconSVG } from "./common.js";
import { copyText } from "../platform.js";

let root, ctx, $;
let index = [];
let timer = 0;

export default {
  id: "find",
  title: "Find",
  mount(el, context) {
    root = el;
    ctx = context;
    $ = sel => root.querySelector(sel);
    root.innerHTML = `
      <div><h2 class="section">Find an item</h2>
        <p class="lead">Searches the bank, Material Storage, shared slots, every character's bags and gear, and the Legendary Armory. The API runs a few minutes behind the game.</p></div>
      <input type="search" class="input" id="fdQuery" placeholder="Item name, for example ecto" autocomplete="off" spellcheck="false" aria-label="Item name">
      <div id="fdResults" aria-live="polite"></div>
      <div id="fdScattered"></div>`;
    $("#fdQuery").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(renderResults, 120); });
    root.addEventListener("click", async e => {
      const copy = e.target.closest("[data-copy]");
      if (copy) copy.lastChild.textContent = (await copyText(copy.dataset.copy)) ? " Copied" : " Couldn't copy";
    });
    ctx.onAccount(setAccount);
    if (ctx.getAccount()) setAccount(ctx.getAccount());
  },
  show() { setTimeout(() => $("#fdQuery")?.focus(), 0); },
};

function setAccount(account) {
  index = account ? buildIndex(account) : [];
  renderResults();
  renderScattered();
}

function placesHTML(e, limit = 8) {
  const places = [...e.places].sort((a, b) => b.count - a.count);
  const shown = places.slice(0, limit).map(p => `<li><span>${esc(p.where)}</span><b>${p.count.toLocaleString()}</b></li>`).join("");
  const more = places.length > limit ? `<li class="muted">and ${plural(places.length - limit, "more place")}</li>` : "";
  return `<ul class="places">${shown}${more}</ul>`;
}

function cardHTML(e, extra = "") {
  const unit = tpUnit(e.price);
  const value = unit ? `<span class="muted">Sells for ${coinHTML(Math.floor(unit * TP_KEEP))} each</span>` : "";
  const chat = e.item.chat_link ? `<button type="button" class="iconbtn" data-copy="${esc(e.item.chat_link)}" title="Copy the chat code">${iconSVG("copy")}<span> Chat code</span></button>` : "";
  return `<article class="card find-card">
    <div class="find-top">${slotHTML({ item: e.item, slot: { id: e.item.id, count: 1 }, tag: "div" })}
      <div><h3 class="rname r-${esc(e.item.rarity)}">${esc(e.item.name)}</h3>
        <p class="muted">${plural(e.total, "in total", "in total")}${extra}</p></div>
      ${chat}</div>
    ${value}
    ${placesHTML(e)}
  </article>`;
}

function renderResults() {
  const q = $("#fdQuery").value;
  const el = $("#fdResults");
  if (!q.trim()) { el.innerHTML = ""; return; }
  const found = search(index, q, 30);
  el.innerHTML = found.length
    ? `<p class="muted">${found.length === 30 ? "First 30 matches" : plural(found.length, "match", "matches")}</p>${found.map(e => cardHTML(e)).join("")}`
    : `<div class="empty-plan">Nothing called "${esc(q.trim())}" on this account. If you only just got it, the API may not show it for a few minutes.</div>`;
}

function renderScattered() {
  const list = scattered(index);
  const wasOpen = $("#fdScattered details")?.open;
  $("#fdScattered").innerHTML = list.length ? `<details class="keeplist"${wasOpen ? " open" : ""}>
    <summary>Spread across characters <span>(${list.length})</span></summary>
    <p>These sit in the bags of three or more characters. Gather them in the bank or shared slots so they stop taking space on every alt.</p>
    ${list.slice(0, 40).map(e => cardHTML(e, ` · on ${e.characters} characters`)).join("")}
  </details>` : "";
}
