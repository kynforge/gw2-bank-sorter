// The item finder: every place an item sits on the account, searchable by name.
import { whereText } from "./account.js";

// "Pétale" and "petale" both become "petale".
export const fold = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SLOT_NAMES = {
  WeaponA1: "weapon set 1", WeaponA2: "weapon set 1 off hand", WeaponB1: "weapon set 2", WeaponB2: "weapon set 2 off hand",
  Backpack: "back", Accessory1: "accessory", Accessory2: "accessory", Ring1: "ring", Ring2: "ring",
};

export function buildIndex(account) {
  const byId = new Map();
  const add = (id, place) => {
    if (!byId.has(id)) byId.set(id, { id, places: [] });
    byId.get(id).places.push(place);
  };
  for (const c of account.containers) {
    for (const cell of c.cells) {
      if (!cell.slot) continue;
      add(cell.slot.id, { where: whereText(c, cell), count: cell.slot.count || 1, kind: c.kind, character: c.kind === "character" ? c.name : null });
    }
  }
  for (const [id, count] of account.storage || []) if (count > 0) add(id, { where: "Material Storage", count, kind: "storage" });
  for (const ch of account.characters || []) {
    for (const e of ch.equipment || []) {
      const slot = e.slot ? SLOT_NAMES[e.slot] || e.slot.toLowerCase() : "from the armory";
      add(e.id, { where: `${ch.name}, equipped (${slot})`, count: 1, kind: "equipped", character: ch.name });
    }
  }
  for (const [id, count] of account.legendary || []) add(id, { where: "Legendary Armory", count, kind: "armory" });

  const entries = [];
  for (const { id, places } of byId.values()) {
    const item = account.items.get(id);
    if (!item) continue;
    // Equipped legendaries are the same copies the armory counts, so they don't add to the total.
    const inArmory = places.some(p => p.kind === "armory");
    const total = places.reduce((n, p) => n + (inArmory && p.kind === "equipped" ? 0 : p.count), 0);
    entries.push({ item, total, places, name: fold(item.name), price: account.prices?.get(id) || null });
  }
  return entries;
}

// Exact name first, then a name with a word starting with the query, then anywhere in the name.
export function search(index, query, limit = 50) {
  const q = fold(query).trim();
  if (!q) return [];
  const wordStart = new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const ranked = [];
  for (const e of index) {
    const rank = e.name === q ? 3 : wordStart.test(e.name) ? 2 : e.name.includes(q) ? 1 : 0;
    if (rank) ranked.push([rank, e]);
  }
  ranked.sort((a, b) => b[0] - a[0] || b[1].total - a[1].total || a[1].item.name.localeCompare(b[1].item.name));
  return ranked.slice(0, limit).map(([, e]) => e);
}

// Items sitting in the bags of several characters, like event tokens stranded on alts.
export function scattered(index, minChars = 3) {
  const out = [];
  for (const e of index) {
    const chars = new Set(e.places.filter(p => p.kind === "character").map(p => p.character));
    if (chars.size >= minChars) out.push({ ...e, characters: chars.size });
  }
  return out.sort((a, b) => b.characters - a.characters || b.total - a.total || a.item.name.localeCompare(b.item.name));
}
