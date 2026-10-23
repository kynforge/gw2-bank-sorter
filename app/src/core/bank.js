// The bank cleanup planner: decides what to do with every slot, and suggests a tidy layout.
// Ported from gw2-bank-sorter.html; everything it needs is passed in, so it can be tested.
import { coinText, plural } from "./format.js";
import { TAB_SIZE, ECTO_ID } from "./account.js";

export const STACK_MAX = 250;
export const TP_KEEP = 0.85;          // seller keeps 85% after the 5% listing fee and 10% exchange fee
const ECTO_PER_RARE = 0.875;          // average ectoplasm from salvaging a level 68+ rare

export const EQUIP = new Set(["Armor", "Weapon", "Back", "Trinket"]);
const NO_STACK = new Set([...EQUIP, "Bag", "Tool", "Gathering", "MiniPet"]);
export const RARITIES = ["Junk", "Basic", "Fine", "Masterwork", "Rare", "Exotic", "Ascended", "Legendary"];

export const ACTIONS = {
  deposit: { title: "Send to Material Storage", short: "Deposit",
    step: "On each character listed, pick Deposit All Materials from the inventory's options menu. Withdraw bank items to an inventory first." },
  stack:   { title: "Merge split stacks", short: "Stack",
    step: "Press Compact in the bank window, or in a character's inventory for stacks in their bags. It merges each of these into the matching stack." },
  use:     { title: "Open, unlock or consume", short: "Use",
    step: "Double-click each one; withdraw bank items first. Unlocks go to your wardrobe, collections or wallet and stop taking a slot." },
  vendor:  { title: "Sell to a merchant", short: "Vendor",
    step: "Sell to any merchant; withdraw bank items first. Sell Junk does the junk in one click." },
  salvage: { title: "Salvage", short: "Salvage",
    step: "Salvage with a kit; withdraw bank items first. Rares of level 68 and up can give Globs of Ectoplasm." },
  sell:    { title: "Sell on the Trading Post", short: "Sell",
    step: "Sell through the Trading Post from your inventory; withdraw bank items first. Values assume you sell to the highest buy order." },
  destroy: { title: "Already unlocked, safe to destroy", short: "Destroy",
    step: "Your account already has these, they can't be sold and no crafting recipe uses them. Right-click each one and choose Destroy; withdraw bank items first. The API doesn't list Mystic Forge recipes, so skip any you're saving for the Forge or a collection." },
};
export const PLAN_ORDER = ["deposit", "stack", "use", "vendor", "salvage", "sell", "destroy"];
const BUNDLES = new Set(["Toy", "ToyTwoHanded", "SmallBundle", "LargeBundle"]);
const SKIN_NOTE = "Its skin isn't in your wardrobe yet. Equip it once first if you want the look.";

export const CATEGORY_ORDER = ["gear", "upgrades", "consumables", "materials", "trophies", "tools", "other"];
export const CATEGORY_NAMES = {
  gear: "Gear", upgrades: "Upgrades", consumables: "Consumables", materials: "Crafting materials",
  trophies: "Trophies & collections", tools: "Tools & gizmos", other: "Everything else",
};

const UNLOCK_TEXT = {
  Dye: "Unlocks this dye for every character.",
  CraftingRecipe: "Teaches a crafting recipe. Use it on a character with that discipline.",
  BagSlot: "Adds a bag slot to a character.",
  BankTab: "Adds a bank tab.",
  CollectibleCapacity: "Expands Material Storage.",
  SharedSlot: "Adds a shared inventory slot.",
  Content: "Unlocks content or a collection item.",
  GliderSkin: "Unlocks a glider skin.",
  Outfit: "Unlocks an outfit in your wardrobe.",
  Champion: "Unlocks a Mistlock champion.",
  Minipet: "Adds a miniature to your collection.",
  JadeBotSkin: "Unlocks a jade bot skin.",
  Ms: "Unlocks a mount skin.",
};

/* ---------- Item helpers ---------- */

export function tpUnit(price) { return price ? (price.now || price.list || 0) : 0; }
export function tpTotal(price, count) { return Math.floor(tpUnit(price) * count * TP_KEEP); }

export function isTradeable(slot, item) {
  if (slot.binding) return false;
  const f = item.flags || [];
  return !f.includes("AccountBound") && !f.includes("SoulbindOnAcquire");
}
export function isStackable(slot, item) {
  return !!item && !NO_STACK.has(item.type) && !slot.charges && !slot.upgrades && !slot.infusions && !slot.skin && !slot.stats;
}
export const stackKey = slot => `${slot.id}|${slot.binding || ""}|${slot.bound_to || ""}`;

// true: already on the account. false: not yet. null: can't tell (no unlocks data, or not an unlockable item).
export function isUnlocked(item, owned) {
  if (!owned || !item) return null;
  const d = item.details || {};
  if (item.type === "MiniPet") return d.minipet_id != null ? owned.minis.has(d.minipet_id) : null;
  if (item.type === "Consumable" && d.type === "Unlock") {
    if (d.unlock_type === "Dye" && d.color_id != null) return owned.dyes.has(d.color_id);
    if (d.unlock_type === "CraftingRecipe" && d.recipe_id != null) return [d.recipe_id, ...(d.extra_recipe_ids || [])].every(id => owned.recipes.has(id));
    return null;
  }
  if (item.type === "Consumable" && d.type === "Transmutation") return d.skins?.length ? d.skins.every(id => owned.skins.has(id)) : null;
  if (EQUIP.has(item.type) && item.default_skin != null && !BUNDLES.has(d.type)) return owned.skins.has(item.default_skin);
  return null;
}

// Collections still needing an item, skin or mini, minus the ones the player chose to ignore.
export function needsFor(needs, ignore, kind, id) {
  if (!needs || id == null) return [];
  return (needs[kind].get(id) || []).filter(c => !ignore.has(c.id));
}
export function collText(list, start = true) {
  const first = `${start ? "The" : "the"} ${list[0].name} collection`;
  return list.length > 1 ? `${first} and ${plural(list.length - 1, "other")}` : first;
}
const listText = names => names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${plural(names.length - 3, "other")}` : names.join(", ");

/* ---------- Analysis ---------- */

export function analyze(account, prefs, { recipeUses = null } = {}) {
  const { items, prices, storable, storage, capacity, containers } = account;
  const startRoom = id => Math.max(0, capacity - (storage.get(id) || 0));
  const room = new Map();
  const roomFor = id => {
    if (!room.has(id)) room.set(id, startRoom(id));
    return room.get(id);
  };
  const ecto = prices.get(ECTO_ID);
  const ectoValue = Math.floor(tpUnit(ecto) * TP_KEEP);
  // Material Storage room, first copies of unlock items and copies kept for collections are shared
  // across every location, bank first.
  const ctx = {
    roomFor, room, startRoom, storable, ectoValue, claimed: new Map(), collKept: new Map(), keep: prefs.keep,
    owned: account.owned, needs: (kind, id) => needsFor(account.needs, prefs.ignore, kind, id),
  };

  const slots = [];
  for (const c of containers) {
    for (const cell of c.cells) {
      const base = { index: slots.length, cid: c.id, kind: c.kind, tab: cell.tab, bag: cell.bag, pos: cell.pos, where: whereOf(c, cell), slot: cell.slot };
      if (!cell.slot) { slots.push({ ...base, action: "empty" }); continue; }
      const item = items.get(cell.slot.id);
      if (!item) { slots.push({ ...base, action: "keep", reason: "The API has no details for this item yet." }); continue; }
      const price = isTradeable(cell.slot, item) ? prices.get(cell.slot.id) : null;
      const r = applyRecipeUses(classify(cell.slot, item, price, ctx, base.where), recipeUses?.get(item.id));
      slots.push({ ...base, item, price, ...r });
    }
  }

  // Split stacks of the same item in one bank or one character's bags: the biggest stacks stay,
  // Compact folds the rest into them. Shared slots have no Compact, so they're left alone.
  const groups = new Map();
  for (const s of slots) {
    if (s.action !== "keep" || s.kind === "shared" || !isStackable(s.slot, s.item)) continue;
    const k = `${s.cid}|${stackKey(s.slot)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const total = g.reduce((n, s) => n + s.slot.count, 0);
    const need = Math.ceil(total / STACK_MAX);
    // The copy kept for a collection stays put; otherwise the biggest stacks do.
    const sorted = [...g].sort((a, b) => !!b.forCollections - !!a.forCollections || b.slot.count - a.slot.count || a.index - b.index);
    for (const s of sorted.slice(need)) {
      s.action = "stack";
      s.reason = `Same item as the stack in ${sorted[0].where}. Compact merges them.`;
    }
  }

  const freeing = new Set(["stack", "use", "vendor", "salvage", "sell", "destroy"]);
  const frees = s => s.slot && (freeing.has(s.action) || (s.action === "deposit" && !s.partial));
  const bankSlots = slots.filter(s => s.kind === "bank");
  const sum = act => slots.filter(s => s.slot && s.action === act).reduce((n, s) => n + (s.value || 0), 0);
  const byContainer = new Map(containers.map(c => [c.id, slots.filter(s => s.cid === c.id)]));

  return {
    slots, byContainer,
    bank: { filled: bankSlots.filter(s => s.slot).length, total: bankSlots.length, freed: bankSlots.filter(frees).length },
    filled: slots.filter(s => s.slot).length, freed: slots.filter(frees).length,
    sell: sum("sell"), vendor: sum("vendor"), layout: planLayout(bankSlots, storable, account.bank.length),
  };
}

function whereOf(c, cell) {
  if (c.kind === "bank") return `Tab ${cell.tab}, slot ${cell.pos}`;
  if (c.kind === "shared") return `Shared slot ${cell.pos}`;
  return `${c.name}, bag ${cell.bag} slot ${cell.pos}`;
}

// A crafting ingredient is never suggested for destroying, and a merchant sale says what it makes.
function applyRecipeUses(r, uses) {
  if (!uses?.length) return r;
  if (r.action === "destroy") return { action: "keep", usedIn: uses, reason: `Used to craft ${listText(uses)}. Keep it for crafting, or destroy it if you never will.` };
  if (r.action === "vendor") return { ...r, usedIn: uses, alt: [r.alt, `Used to craft ${listText(uses)}.`].filter(Boolean).join(" ") };
  return { ...r, usedIn: uses };
}

// Checks that apply to every item first (Material Storage, always-keep, collections), then the item's own rules.
function classify(slot, item, price, ctx, where) {
  const count = slot.count || 1;
  const tp = price ? tpTotal(price, count) : 0;
  // Always-keep items can still be deposited or stacked (nothing is lost), but never sold, used, salvaged or destroyed.
  const pinned = ctx.keep.has(item.id);
  const KEPT = "On your always-keep list.";

  if (ctx.storable.has(item.id)) {
    const free = ctx.roomFor(item.id);
    if (free >= count) {
      ctx.room.set(item.id, free - count);
      return { action: "deposit", deposit: count, pinned, reason: `Material Storage has room for all ${count.toLocaleString()}.` };
    }
    if (free > 0) {
      ctx.room.set(item.id, 0);
      const left = count - free;
      const leftValue = price ? tpTotal(price, left) : 0;
      return { action: "deposit", partial: true, deposit: free, pinned,
        reason: `Storage has room for ${free.toLocaleString()} of ${count.toLocaleString()}. The other ${left.toLocaleString()} stay behind.`,
        alt: !pinned && leftValue >= 100 ? `Selling those ${left.toLocaleString()} would bring ${coinText(leftValue)}.` : "" };
    }
    const full = ctx.startRoom(item.id) > 0
      ? "The deposits above fill Material Storage for this"
      : "Material Storage is already full of this";
    if (pinned) return { action: "keep", pinned, reason: `${KEPT} ${full}, so it stays where it is.` };
    if (tp > 0) return { action: "sell", value: tp, reason: `${full}, so the stack is surplus.` };
    return { action: "keep", reason: `${full} and it can't be sold. Keep it for crafting.` };
  }
  if (pinned) return { action: "keep", pinned, reason: KEPT };

  // An unfinished collection needs one copy: keep the first one found and point the others at it.
  // Materials never get here; Material Storage already counts as having one.
  const colls = ctx.needs("items", item.id);
  if (colls.length) {
    const kept = ctx.collKept.get(item.id);
    if (!kept) {
      ctx.collKept.set(item.id, where);
      return { action: "keep", forCollections: colls,
        reason: `${collText(colls)} still ${colls.length > 1 ? "need" : "needs"} this.`,
        alt: "Open the collection in your Hero panel to see how to add it." };
    }
    const r = classifyItem(slot, item, price, ctx, where);
    if (r.action !== "keep") r.alt = [r.alt, `The copy in ${kept} is kept for ${collText(colls, false)}.`].filter(Boolean).join(" ");
    return r;
  }
  return classifyItem(slot, item, price, ctx, where);
}

function classifyItem(slot, item, price, ctx, where) {
  const count = slot.count || 1;
  const d = item.details || {};
  const flags = new Set(item.flags || []);
  const tp = price ? tpTotal(price, count) : 0;
  const ifOwned = tp >= 100 ? `Already have it? It sells for ${coinText(tp)}.` : "";

  if (item.rarity === "Junk") {
    if (item.vendor_value > 0 && !flags.has("NoSell")) return { action: "vendor", value: item.vendor_value * count, reason: "Junk. Merchants buy it and nothing else uses it." };
    return { action: "keep", reason: "Junk that merchants won't buy. You can destroy it." };
  }
  const unlocked = isUnlocked(item, ctx.owned);
  const isUnlockItem = item.type === "MiniPet" || (item.type === "Consumable" && (d.type === "Unlock" || d.type === "Transmutation"));
  if (isUnlockItem) {
    const miniColls = item.type === "MiniPet" ? ctx.needs("minis", d.minipet_id) : [];
    const what = (item.type === "MiniPet" ? "Adds this miniature to your collection."
      : d.type === "Transmutation" ? "Unlocks this skin in your wardrobe."
      : UNLOCK_TEXT[d.unlock_type] || "Unlocks something for your account.")
      + (miniColls.length ? ` It also counts toward ${collText(miniColls, false)}.` : "");
    if (unlocked === true) return { unlocked, ...alreadyOwned(item, flags, count, tp, "You already have this unlocked") };
    // Only one copy needs using; any other copy becomes a spare once it has been.
    const first = ctx.claimed.get(item.id);
    if (first) return { unlocked, ...alreadyOwned(item, flags, count, tp, `A spare. You'll have this once you use the copy in ${first}`) };
    ctx.claimed.set(item.id, where);
    if (unlocked === false) return { unlocked, action: "use", reason: `${what} You don't have it yet.`, alt: tp >= 100 ? `If you don't want it, it sells for ${coinText(tp)}.` : "" };
    return { action: "use", reason: what, alt: ifOwned };
  }
  if (item.type === "Consumable" && d.type === "Currency") return { action: "use", reason: "Adds to your wallet, where it takes no space." };
  if (item.type === "Container") return { action: "use", reason: "A container. Open it and keep only what you want from inside.", alt: tp >= 100 ? `Or sell it unopened for ${coinText(tp)}.` : "" };
  if (EQUIP.has(item.type)) {
    const r = classifyGear(slot, item, flags, count, tp, ctx.ectoValue, unlocked);
    const skinColls = unlocked === true ? [] : ctx.needs("skins", item.default_skin);
    if (skinColls.length && r.action !== "keep") r.alt = `Equip it once first: its skin counts toward ${collText(skinColls, false)}.`;
    else if (unlocked === false && r.action !== "keep" && !r.alt) r.alt = SKIN_NOTE;
    return { unlocked, ...r };
  }
  return { action: "keep", reason: keepReason(item) };
}

// For an item whose unlock the account already has: sell it, then salvage (gear only), then vendor, else destroy.
function alreadyOwned(item, flags, count, tp, lead, allowSalvage = false) {
  if (tp >= 100) return { action: "sell", value: tp, reason: `${lead}.` };
  if (allowSalvage && !flags.has("NoSalvage")) return { action: "salvage", reason: `${lead}. Salvage it for materials.` };
  if (item.vendor_value > 0 && !flags.has("NoSell")) return { action: "vendor", value: item.vendor_value * count, reason: `${lead}. A merchant will buy it.` };
  if (tp > 0) return { action: "sell", value: tp, reason: `${lead}.` };
  return { action: "destroy", reason: `${lead}, and it can't be sold.` };
}

function classifyGear(slot, item, flags, count, tp, ectoValue, unlocked) {
  const canSalvage = !flags.has("NoSalvage");
  const keep = (reason, alt = "") => ({ action: "keep", reason, alt });
  if (item.rarity === "Ascended" || item.rarity === "Legendary") return keep(`${item.rarity} gear. Keep it.`);
  if (item.level === 0) {
    if (unlocked === true) return { ...alreadyOwned(item, flags, count, tp, "Its skin is already in your wardrobe", true), alt: "Some collections ask for the item itself, so check that first." };
    if (unlocked === false) return keep("Its skin isn't in your wardrobe yet. Equip it once to unlock the skin.");
    return keep("Level 0 equipment is usually a skin or a special item. Check your wardrobe before you get rid of it.");
  }
  if (slot.skin) return keep("A skin has been applied to this piece.");
  if (item.rarity === "Exotic" && item.level === 80) return keep("Level 80 exotic. Keep it if a build uses it.", tp ? `If not, it sells for ${coinText(tp)}.` : "");

  if (item.rarity === "Rare" && item.level >= 68 && canSalvage) {
    const ev = Math.floor(ECTO_PER_RARE * ectoValue * count);
    if (tp > ev) return { action: "sell", value: tp, reason: `Sells for more than the Globs of Ectoplasm salvaging would average (about ${coinText(ev)}).` };
    return { action: "salvage", value: ev, reason: `Salvaging averages about 0.9 Globs of Ectoplasm, worth about ${coinText(ev)}${tp ? `. Selling would bring ${coinText(tp)}` : ""}.` };
  }
  const tier = item.level < 80 ? `Level ${item.level}` : `${item.rarity} quality`;
  if (tp >= 100) return { action: "sell", value: tp, reason: `${tier}, so it's outdated for a level 80 character.` };
  if (canSalvage) return { action: "salvage", reason: `${tier}. Salvage it for crafting materials.` };
  if (item.vendor_value > 0 && !flags.has("NoSell")) return { action: "vendor", value: item.vendor_value * count, reason: `${tier} and it can't be salvaged.` };
  return keep("It can't be salvaged or sold.");
}

function keepReason(item) {
  switch (item.type) {
    case "UpgradeComponent": return "Runes, sigils and infusions are worth keeping for builds.";
    case "Consumable": return "A consumable. Keep it if you use it. It can't go to Material Storage.";
    case "Tool": case "Gathering": return "A tool. Keep it.";
    case "Gizmo": return "A special item. Keep it.";
    case "Bag": return "A spare bag. Equip it, or keep it for a new character.";
    case "Trophy": return "A trophy or collection item. Check whether a collection still needs it.";
    case "CraftingMaterial": return "A crafting material that Material Storage doesn't take.";
    default: return "Nothing to do with this one.";
  }
}

/* ---------- Suggested layout ---------- */

export function categoryOf(item, storable) {
  if (!item) return "other";
  if (EQUIP.has(item.type)) return "gear";
  if (item.type === "UpgradeComponent") return "upgrades";
  if (storable.has(item.id) || item.type === "CraftingMaterial") return "materials";
  if (item.type === "Consumable") return "consumables";
  if (item.type === "Trophy") return "trophies";
  if (["Tool", "Gathering", "Gizmo", "Bag", "Key"].includes(item.type)) return "tools";
  return "other";
}

function sortKey(e, storable) {
  const it = e.item;
  if (!it) return ["~", ""];
  const rar = String(9 - RARITIES.indexOf(it.rarity));
  const sub = (it.details && it.details.type) || "";
  switch (e.cat) {
    case "gear": return [{ Weapon: 0, Armor: 1, Back: 2, Trinket: 3 }[it.type] ?? 9, sub, rar, String(999 - it.level).padStart(3, "0"), it.name];
    case "upgrades": return [{ Rune: 0, Sigil: 1, Gem: 2, Default: 3 }[sub] ?? 9, rar, it.name];
    case "materials": return [String(storable.get(it.id)?.order ?? 999999).padStart(7, "0"), it.name];
    default: return [it.type, sub, it.name];
  }
}
export function compareEntries(a, b, storable) {
  const ka = sortKey(a, storable), kb = sortKey(b, storable);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i] ?? "", y = kb[i] ?? "";
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function planLayout(slots, storable, bankSize) {
  const entries = [];
  const merged = new Map();
  for (const s of slots) {
    const stays = s.action === "keep" || s.action === "stack" || (s.action === "deposit" && s.partial);
    if (!stays) continue;
    const count = s.action === "deposit" ? s.slot.count - s.deposit : (s.slot.count || 1);
    if (isStackable(s.slot, s.item)) {
      const k = stackKey(s.slot);
      if (!merged.has(k)) merged.set(k, { item: s.item, slot: s.slot, count: 0, from: [] });
      const m = merged.get(k);
      m.count += count;
      m.from.push(s);
    } else {
      entries.push({ item: s.item, slot: s.slot, count, from: [s] });
    }
  }
  for (const m of merged.values()) {
    for (let left = m.count; left > 0; left -= STACK_MAX) entries.push({ ...m, count: Math.min(STACK_MAX, left) });
  }
  for (const e of entries) e.cat = categoryOf(e.item, storable);

  const cats = CATEGORY_ORDER
    .map(id => ({ id, entries: entries.filter(e => e.cat === id).sort((a, b) => compareEntries(a, b, storable)) }))
    .filter(c => c.entries.length);
  return packTabs(cats, Math.max(1, Math.ceil(bankSize / TAB_SIZE)));
}

export function packTabs(cats, tabCount) {
  const chunk = c => {
    const out = [];
    for (let i = 0; i < c.entries.length; i += TAB_SIZE) out.push({ cat: c.id, entries: c.entries.slice(i, i + TAB_SIZE) });
    return out;
  };
  const size = t => t.reduce((n, p) => n + p.entries.length, 0);
  // Every category starts in its own tab(s). While that needs more tabs than the bank has,
  // merge the smallest neighbouring pair that still fits in one tab, so the order stays intact.
  let tabs = cats.flatMap(c => chunk(c).map(part => [part]));
  while (tabs.length > tabCount) {
    let best = -1;
    for (let i = 0; i < tabs.length - 1; i++) {
      const n = size(tabs[i]) + size(tabs[i + 1]);
      if (n <= TAB_SIZE && (best < 0 || n < size(tabs[best]) + size(tabs[best + 1]))) best = i;
    }
    if (best < 0) break;
    tabs.splice(best, 2, [...tabs[best], ...tabs[best + 1]]);
  }
  if (tabs.length > tabCount) {
    // Not enough tabs to keep groups apart: flow everything in category order.
    const flat = cats.flatMap(c => c.entries);
    tabs = [];
    for (let i = 0; i < flat.length; i += TAB_SIZE) {
      const parts = [];
      for (const e of flat.slice(i, i + TAB_SIZE)) {
        if (!parts.length || parts[parts.length - 1].cat !== e.cat) parts.push({ cat: e.cat, entries: [] });
        parts[parts.length - 1].entries.push(e);
      }
      tabs.push(parts);
    }
  }
  while (tabs.length < tabCount) tabs.push([]);
  return tabs.map(parts => ({ parts, entries: parts.flatMap(p => p.entries) }));
}
