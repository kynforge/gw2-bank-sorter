// Small rendering helpers shared by the panels.
import { esc } from "../core/format.js";
import { ACTIONS } from "../core/bank.js";

export function pipHTML(action) {
  if (!ACTIONS[action]) return "";
  return `<span class="pip act-${action}" aria-hidden="true"><svg><use href="#i-${action}"/></svg></span>`;
}

// One item slot: icon, rarity border, stack count and the action pip. A button unless tag says otherwise.
export function slotHTML({ item, slot, count, action, attrs = "", classes = "", tag = "button" }) {
  if (!slot) return `<div class="slot empty" aria-hidden="true"></div>`;
  const n = count ?? slot.count ?? 1;
  const name = item ? item.name : `Unknown item ${slot.id}`;
  const label = `${name}${n > 1 ? `, ${n}` : ""}${ACTIONS[action] ? `: ${ACTIONS[action].short}` : ""}`;
  const icon = item?.icon ? `<img src="${esc(item.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="noicon">?</span>`;
  const typeAttr = tag === "button" ? ` type="button" aria-label="${esc(label)}"` : ` aria-hidden="true"`;
  return `<${tag} class="slot r-${esc(item?.rarity || "Basic")} ${classes}"${typeAttr} ${attrs}>${icon}${n > 1 ? `<span class="cnt">${n}</span>` : ""}${pipHTML(action)}</${tag}>`;
}

export function itemLine(item, slot) {
  if (!item) return `Item ${slot?.id ?? ""}`;
  const d = item.details || {};
  const kind = { UpgradeComponent: "Upgrade", CraftingMaterial: "Crafting material", MiniPet: "Miniature", Gathering: "Gathering tool" }[item.type] || item.type;
  const sub = d.type && d.type !== "Default" && d.type !== "Generic" ? ` (${d.type.replace(/([a-z])([A-Z])/g, "$1 $2")})` : "";
  const lvl = item.level ? ` · Level ${item.level}` : "";
  return `${item.rarity}${lvl} · ${kind}${sub}`;
}

export function iconSVG(id) {
  return `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
}

// "Read at 4:05 PM" for an account's load time.
export function readAt(account) {
  return account.loadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Shown by panels that need data the example account doesn't have, or before anything has loaded.
export function needsAccountHTML(text) {
  return `<div class="empty-plan">${esc(text)} <button type="button" class="linkish" data-goto-settings>Add your API key in Settings</button>.</div>`;
}
