// Character stats from equipped gear, using the API's own numbers.
// An item's attribute = round(attribute_adjustment × multiplier + value), checked against in-game values.

export const BASE = { Power: 1000, Precision: 1000, Toughness: 1000, Vitality: 1000, CritDamage: 0, ConditionDamage: 0, ConditionDuration: 0, Healing: 0, BoonDuration: 0 };

// API attribute keys -> the names the game shows.
export const ATTR_NAMES = {
  Power: "Power", Precision: "Precision", Toughness: "Toughness", Vitality: "Vitality", CritDamage: "Ferocity",
  ConditionDamage: "Condition Damage", ConditionDuration: "Expertise", Healing: "Healing Power", BoonDuration: "Concentration",
  AgonyResistance: "Agony Resistance",
};
const FROM_TEXT = Object.fromEntries(Object.entries(ATTR_NAMES).map(([k, v]) => [v.toLowerCase(), k]));
FROM_TEXT.healing = "Healing";

// Might stacks, Fury uptime (0–1) and crit from Fury, extra crit chance, extra durations (%) and flat stats from food.
export const DEFAULT_ASSUMPTIONS = { might: 25, fury: 1, furyCrit: 25, extraCrit: 0, condDuration: 0, boonDuration: 0, flat: {} };

export const ARMOR_SLOTS = ["Helm", "Shoulders", "Coat", "Gloves", "Leggings", "Boots"];
export const TRINKET_SLOTS = ["Backpack", "Amulet", "Ring1", "Ring2", "Accessory1", "Accessory2"];
const TWO_HANDED = new Set(["Greatsword", "Hammer", "LongBow", "Rifle", "ShortBow", "Staff", "Harpoon", "Speargun", "Trident"]);
export const SLOT_LABELS = {
  Helm: "Helm", Shoulders: "Shoulders", Coat: "Chest", Gloves: "Gloves", Leggings: "Leggings", Boots: "Boots",
  WeaponA1: "Weapon 1", WeaponA2: "Weapon 1 off hand", WeaponB1: "Weapon 2", WeaponB2: "Weapon 2 off hand",
  Backpack: "Back", Amulet: "Amulet", Ring1: "Ring 1", Ring2: "Ring 2", Accessory1: "Accessory 1", Accessory2: "Accessory 2",
};
// Health at level 80 before Vitality, by profession.
const BASE_HEALTH = { Warrior: 9212, Necromancer: 9212, Revenant: 5922, Engineer: 5922, Ranger: 5922, Mesmer: 5922, Guardian: 1645, Thief: 1645, Elementalist: 1645 };

export function itemStat(adj, itemstat) {
  const out = {};
  for (const a of itemstat?.attributes || []) out[a.attribute] = Math.round(adj * a.multiplier + a.value);
  return out;
}

export function addAttrs(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = (out[k] || 0) + v;
  return out;
}

export const isTwoHanded = item => TWO_HANDED.has(item?.details?.type);

// The slots that count: armor, trinkets and the chosen weapon set (its off hand only for one-handed weapons).
export function activeSlots(equipment, items, weaponSet = "A") {
  const main = equipment.find(e => e.slot === `Weapon${weaponSet}1`);
  const weapons = [`Weapon${weaponSet}1`];
  if (!main || !isTwoHanded(items.get(main.id))) weapons.push(`Weapon${weaponSet}2`);
  return [...ARMOR_SLOTS, ...weapons, ...TRINKET_SLOTS];
}

// One piece's own attributes: picked stats, the stat set it was given, or its fixed stats.
function pieceAttributes(e, item, itemstats) {
  if (e.stats?.attributes && Object.keys(e.stats.attributes).length) return { attrs: { ...e.stats.attributes }, statId: e.stats.id ?? null };
  const adj = item?.details?.attribute_adjustment;
  if (e.stats?.id != null && adj != null && itemstats.has(e.stats.id)) return { attrs: itemStat(adj, itemstats.get(e.stats.id)), statId: e.stats.id };
  const infix = item?.details?.infix_upgrade;
  if (infix?.attributes?.length) return { attrs: Object.fromEntries(infix.attributes.map(a => [a.attribute, a.modifier])), statId: infix.id ?? null };
  return { attrs: {}, statId: null };
}

// "+25 Power" -> ["Power", 25]; "+10% Condition Duration" -> ["%ConditionDuration", 10]. Anything else is ignored.
function parseBonus(line) {
  const m = /^\+(\d+)(%?) (.+)$/.exec(String(line).trim());
  if (!m) return null;
  const what = m[3].toLowerCase();
  if (m[2]) {
    if (what === "condition duration") return ["%ConditionDuration", +m[1]];
    if (what === "boon duration") return ["%BoonDuration", +m[1]];
    return null;
  }
  return FROM_TEXT[what] ? [FROM_TEXT[what], +m[1]] : null;
}

export function gearAttributes(equipment, { items, itemstats }, { weaponSet = "A" } = {}) {
  const bySlot = new Map((equipment || []).map(e => [e.slot, e]));
  const slots = activeSlots(equipment || [], items, weaponSet);
  let attrs = {};
  const missing = [], sources = [];
  const runes = new Map();      // rune id -> armor pieces carrying it
  let upgrades = {};
  for (const slot of slots) {
    const e = bySlot.get(slot);
    if (!e) { missing.push(slot); continue; }
    const item = items.get(e.id);
    const { attrs: own, statId } = pieceAttributes(e, item, itemstats);
    sources.push({ slot, label: item?.name || `Item ${e.id}`, attrs: own, statId, itemId: e.id, legendary: item?.rarity === "Legendary", adj: item?.details?.attribute_adjustment ?? null, choices: item?.details?.stat_choices || null });
    attrs = addAttrs(attrs, own);
    for (const id of [...(e.upgrades || []), ...(e.infusions || [])]) {
      const u = items.get(id);
      if (!u) continue;
      if (u.details?.type === "Rune") { if (ARMOR_SLOTS.includes(slot)) runes.set(id, (runes.get(id) || 0) + 1); continue; }
      for (const a of u.details?.infix_upgrade?.attributes || []) upgrades = addAttrs(upgrades, { [a.attribute]: a.modifier });
    }
  }
  const durations = { condDuration: 0, boonDuration: 0 };
  for (const [id, count] of runes) {
    const rune = items.get(id);
    let own = {};
    for (const line of (rune.details?.bonuses || []).slice(0, Math.min(6, count))) {
      const b = parseBonus(line);
      if (!b) continue;
      if (b[0] === "%ConditionDuration") durations.condDuration += b[1];
      else if (b[0] === "%BoonDuration") durations.boonDuration += b[1];
      else own = addAttrs(own, { [b[0]]: b[1] });
    }
    sources.push({ slot: "Runes", label: rune.name, attrs: own, count });
    attrs = addAttrs(attrs, own);
  }
  if (Object.keys(upgrades).length) {
    sources.push({ slot: "Upgrades", label: "Infusions and jewels", attrs: upgrades });
    attrs = addAttrs(attrs, upgrades);
  }
  return { attrs, missing, sources, durations };
}

// What the attributes mean in combat, with the boons and food from the assumptions.
export function derived(attrs, a = DEFAULT_ASSUMPTIONS, profession = null) {
  const v = k => (attrs[k] || 0) + ((a.flat || {})[k] || 0);
  const precision = v("Precision");
  return {
    power: v("Power") + 30 * (a.might || 0),
    precision,
    critChance: Math.min(100, 5 + (precision - 1000) / 21 + (a.fury || 0) * (a.furyCrit ?? 25) + (a.extraCrit || 0)),
    critDamage: 150 + v("CritDamage") / 15,
    condiDamage: v("ConditionDamage") + 30 * (a.might || 0),
    condDuration: Math.min(100, v("ConditionDuration") / 15 + (a.condDuration || 0)),
    boonDuration: Math.min(100, v("BoonDuration") / 15 + (a.boonDuration || 0)),
    healing: v("Healing"),
    toughness: v("Toughness"),
    vitality: v("Vitality"),
    health: profession && BASE_HEALTH[profession] ? BASE_HEALTH[profession] + 10 * v("Vitality") : null,
  };
}
