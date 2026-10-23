// Loads everything the panels need from one API key (or the built-in example) into one Account object.
import { getJSON, getMany, store, UserError } from "./api.js";
import { EXAMPLE, exampleData } from "./example.js";
import { plural } from "./format.js";

export const TAB_SIZE = 30;
export const ECTO_ID = 19721;   // Glob of Ectoplasm, priced for the salvage-or-sell comparison

/* ---------- Containers ---------- */

// Every place items sit: the bank, shared inventory slots, then each character's bags.
export function buildContainers(bank, shared, characters) {
  const list = [{ id: "bank", kind: "bank", name: "Bank",
    cells: bank.map((slot, i) => ({ slot, tab: Math.floor(i / TAB_SIZE) + 1, pos: (i % TAB_SIZE) + 1 })) }];
  if (shared.length) list.push({ id: "shared", kind: "shared", name: "Shared inventory", cells: shared.map((slot, i) => ({ slot, pos: i + 1 })) });
  for (const c of [...characters].sort((a, b) => a.name.localeCompare(b.name))) {
    const cells = [], bags = [];
    (c.bags || []).forEach((bag, bi) => {
      if (!bag) return;
      const inv = bag.inventory || [];
      bags.push({ n: bi + 1, id: bag.id, start: cells.length, len: inv.length });
      inv.forEach((slot, j) => cells.push({ slot, bag: bi + 1, pos: j + 1 }));
    });
    list.push({ id: `char:${c.name}`, kind: "character", name: c.name, bags, cells });
  }
  return list;
}

export function whereText(c, cell) {
  if (c.kind === "bank") return `Tab ${cell.tab}, slot ${cell.pos}`;
  if (c.kind === "shared") return `Shared slot ${cell.pos}`;
  return `${c.name}, bag ${cell.bag} slot ${cell.pos}`;
}

export function toOwned({ dyes, minis, recipes, skins }) {
  return { dyes: new Set(dyes || []), minis: new Set(minis || []), recipes: new Set(recipes || []), skins: new Set(skins || []) };
}

/* ---------- Collections ---------- */

// Collection definitions are public and only change with game updates, so a compact copy is cached
// per game build: achievement id -> [name, bits], where each bit is 0 (text) or [type letter, id].
const COLL_STORE = "gw2c.collections";
const COLL_VERSION = 1;
const BIT_TYPES = { Item: "I", Skin: "S", Minipet: "M" };

export function compactAchievements(list) {
  const out = {};
  for (const a of list || []) {
    const bits = (a.bits || []).map(b => BIT_TYPES[b.type] && b.id != null ? [BIT_TYPES[b.type], b.id] : 0);
    if (bits.some(Boolean)) out[a.id] = [a.name, bits];
  }
  return out;
}

// One download at a time: a Refresh while it's running reuses the same request.
let defsInFlight = null;
function collectionDefs(onStatus) {
  defsInFlight ||= fetchCollectionDefs(onStatus).finally(() => { defsInFlight = null; });
  return defsInFlight;
}

async function fetchCollectionDefs(onStatus) {
  const build = await getJSON("/build").then(b => b?.id ?? null, () => null);
  try {
    const cached = JSON.parse(store.get(COLL_STORE) || "null");
    if (cached && cached.v === COLL_VERSION && build && cached.build === build) return cached.data;
  } catch { /* unreadable cache: fetch again */ }
  const ids = (await getJSON("/achievements")) || [];
  const list = await getMany("/achievements", ids, {
    concurrency: 8,
    onProgress: (n, total) => onStatus(`Checking your collections (${n} of ${total}). This only takes a while after a game update…`),
  });
  const data = compactAchievements(list);
  if (build) store.set(COLL_STORE, JSON.stringify({ v: COLL_VERSION, build, data }));
  return data;
}

// What unfinished collections still need, by item, skin and mini id. Finished pieces are left out.
export function buildNeeds(defs, progress) {
  const prog = new Map((progress || []).map(p => [p.id, p]));
  const needs = { items: new Map(), skins: new Map(), minis: new Map(), names: new Map() };
  const maps = { I: needs.items, S: needs.skins, M: needs.minis };
  for (const [aid, [name, bits]] of Object.entries(defs)) {
    const p = prog.get(+aid);
    if (p?.done) continue;
    const have = new Set(p?.bits || []);
    const coll = { id: +aid, name };
    needs.names.set(+aid, name);
    bits.forEach((b, i) => {
      if (!b || have.has(i)) return;
      const map = maps[b[0]];
      if (!map.has(b[1])) map.set(b[1], []);
      if (!map.get(b[1]).some(c => c.id === coll.id)) map.get(b[1]).push(coll);
    });
  }
  return needs;
}

/* ---------- Catalog ---------- */

const isTradeable = (slot, item) => {
  if (slot.binding) return false;
  const f = item.flags || [];
  return !f.includes("AccountBound") && !f.includes("SoulbindOnAcquire");
};

// Item details for everything in the containers and on characters, Trading Post prices for what can be
// sold, and Material Storage's categories.
async function loadCatalog(containers, characters, onStatus, extraIds = []) {
  const all = containers.flatMap(c => c.cells.map(cell => cell.slot)).filter(Boolean);
  const equipped = characters.flatMap(c => c.equipment || []);
  const ids = [...new Set([
    ...all.map(s => s.id),
    ...containers.flatMap(c => (c.bags || []).map(b => b.id)),
    ...[...all, ...equipped].flatMap(s => [...(s.upgrades || []), ...(s.infusions || [])]),
    ...equipped.map(e => e.id),
    ...extraIds,   // Material Storage and Legendary Armory, so the finder can name them
  ])];
  onStatus(`Looking up ${plural(ids.length, "item")}…`);
  const [itemList, matCats] = await Promise.all([getMany("/items", ids), getJSON("/materials", { ids: "all", lang: "en" })]);
  const items = new Map(itemList.map(i => [i.id, i]));

  const tradeIds = new Set([ECTO_ID]);
  for (const s of all) if (items.has(s.id) && isTradeable(s, items.get(s.id))) tradeIds.add(s.id);
  onStatus("Checking Trading Post prices…");
  const priceList = await getMany("/commerce/prices", [...tradeIds]);
  const prices = new Map(priceList.map(p => [p.id, { now: p.buys?.unit_price || 0, list: p.sells?.unit_price || 0 }]));

  const storable = new Map();
  for (const cat of matCats || []) cat.items.forEach((id, i) => storable.set(id, { name: cat.name, order: (cat.order ?? cat.id) * 1000 + i }));
  return { items, prices, storable };
}

// The parts of a character the panels use, whichever endpoint it came from. Without an active
// equipment tab, the plain equipment list also holds gear from other tabs and the armory: keep only
// what is worn.
const WORN = new Set(["Equipped", "EquippedFromLegendaryArmory"]);
export function characterInfo(c) {
  const tabs = c.equipment_tabs || [];
  const active = tabs.find(t => t.is_active) || tabs.find(t => t.tab === c.active_equipment_tab);
  const worn = c.equipment ? c.equipment.filter(e => e.slot && (!e.location || WORN.has(e.location))) : null;
  return {
    name: c.name, profession: c.profession || null, level: c.level ?? null,
    equipment: active?.equipment?.length ? active.equipment : worn,
    equipmentTab: active ? (active.name || `Tab ${active.tab}`) : null,
  };
}

/* ---------- Loaders ---------- */

const noop = () => {};

export async function loadExample({ onStatus = noop } = {}) {
  const { bank, shared, characters } = exampleData();
  const containers = buildContainers(bank, shared, characters);
  const [catalog, needs] = await Promise.all([
    loadCatalog(containers, characters, onStatus, Object.keys(EXAMPLE.storage).map(Number)),
    getMany("/achievements", EXAMPLE.collections.map(c => c.id))
      .then(list => buildNeeds(compactAchievements(list), EXAMPLE.collections), () => null),
  ]);
  const legendary = new Map();
  for (const c of characters) for (const e of c.equipment) legendary.set(e.id, Math.min(2, (legendary.get(e.id) || 0) + 1));
  return {
    source: "example", name: "Example account", loadedAt: new Date(), perms: new Set(), bank, containers, ...catalog,
    storage: new Map(Object.entries(EXAMPLE.storage).map(([k, v]) => [+k, v])),
    capacity: EXAMPLE.capacity, inferred: EXAMPLE.capacity,
    owned: toOwned(EXAMPLE.owned), unlocks: "checked", chars: "checked",
    needs, colls: needs ? "checked" : "failed", needsReady: Promise.resolve(needs),
    characters: characters.map(characterInfo), legendary,
    done: {
      worldbosses: new Set(EXAMPLE.done.worldbosses), mapchests: new Set(EXAMPLE.done.mapchests),
      dailycrafting: new Set(EXAMPLE.done.dailycrafting),
    },
    vault: EXAMPLE.vault,
  };
}

// Every character with bags and gear. One call for all of them, or one per character if that fails.
async function loadCharacters(key, onStatus) {
  try {
    onStatus("Reading your characters…");
    const list = await getJSON("/characters", { ids: "all", access_token: key, v: "latest" }, { auth: true });
    if (Array.isArray(list)) return list;
  } catch { /* fall back to one request per character */ }
  const names = (await getJSON("/characters", { access_token: key }, { auth: true })) || [];
  const out = [];
  for (let i = 0; i < names.length; i += 6) {
    onStatus(`Reading character bags (${Math.min(i + 6, names.length)} of ${names.length})…`);
    const batch = await Promise.all(names.slice(i, i + 6).map(name =>
      getJSON(`/characters/${encodeURIComponent(name)}/inventory`, { access_token: key }, { auth: true })
        .then(inv => ({ name, bags: inv?.bags || [] }))));
    out.push(...batch);
  }
  return out;
}

const optional = (ok, fn) => ok ? fn().catch(() => null) : Promise.resolve(null);
const asSet = list => Array.isArray(list) ? new Set(list) : null;

export async function loadAccount(key, { onStatus = noop, capacity: savedCapacity } = {}) {
  onStatus("Checking your key…");
  const auth = { auth: true };
  const token = await getJSON("/tokeninfo", { access_token: key }, auth);
  const perms = new Set(token?.permissions || []);
  const missing = ["account", "inventories"].filter(p => !perms.has(p));
  if (missing.length) throw new UserError(`This key is missing the ${missing.join(" and ")} permission. Create a new key with account and inventories ticked.`);
  const get = (path, params = {}) => getJSON(path, { access_token: key, ...params }, auth);

  // Everything below is optional: without the permission, or if a call fails, the rest still works.
  const canCheck = perms.has("unlocks");
  const unlockLists = optional(canCheck, () =>
    Promise.all(["dyes", "minis", "recipes", "skins"].map(n => get(`/account/${n}`)))
      .then(([dyes, minis, recipes, skins]) => toOwned({ dyes, minis, recipes, skins })));
  const canChars = perms.has("characters");
  const charList = optional(canChars, () => loadCharacters(key, onStatus));
  const canColls = perms.has("progression");
  const collNeeds = optional(canColls, () =>
    Promise.all([collectionDefs(onStatus), get("/account/achievements")]).then(([defs, progress]) => buildNeeds(defs, progress)));
  const legendaryList = optional(canCheck, () => get("/account/legendaryarmory"));
  const done = Promise.all(["worldbosses", "mapchests", "dailycrafting"].map(n => optional(canColls, () => get(`/account/${n}`))));
  const vault = Promise.all(["daily", "weekly", "special"].map(n => get(`/account/wizardsvault/${n}`).catch(() => null)))
    .then(([daily, weekly, special]) => (daily || weekly || special) ? { daily, weekly, special } : null);

  onStatus("Reading your bank, Material Storage and inventories…");
  const [account, bank, mats, shared, owned, characters] = await Promise.all([
    get("/account"), get("/account/bank"), get("/account/materials"),
    get("/account/inventory").catch(() => []),
    unlockLists, charList,
  ]);
  const chars = characters || [];
  const containers = buildContainers(bank || [], shared || [], chars);
  const storage = new Map((mats || []).filter(m => m.count > 0).map(m => [m.id, m.count]));
  const [legendary, [worldbosses, mapchests, dailycrafting], vaultData] = await Promise.all([legendaryList, done, vault]);
  const catalog = await loadCatalog(containers, chars, onStatus, [...storage.keys(), ...(legendary || []).map(l => l.id)]);
  let top = 0;
  for (const n of storage.values()) top = Math.max(top, n);
  const inferred = Math.max(250, Math.ceil(top / 250) * 250);

  const result = {
    source: "account", name: account?.name || "Your account", loadedAt: new Date(), key, perms,
    bank: bank || [], containers, ...catalog,
    storage, inferred, capacity: savedCapacity >= 250 ? Math.max(savedCapacity, inferred) : inferred,
    owned, unlocks: owned ? "checked" : canCheck ? "failed" : "missing",
    chars: characters ? "checked" : canChars ? "failed" : "missing",
    needs: null, colls: canColls ? "loading" : "missing",
    characters: chars.map(characterInfo),
    legendary: new Map((legendary || []).map(l => [l.id, l.count])),
    done: { worldbosses: asSet(worldbosses), mapchests: asSet(mapchests), dailycrafting: asSet(dailycrafting) },
    vault: vaultData,
  };
  // Collection data can take a while on the first visit after a game update, so the account is usable
  // without it and needsReady settles once it arrives.
  result.needsReady = collNeeds.then(needs => {
    result.needs = needs;
    if (canColls) result.colls = needs ? "checked" : "failed";
    return needs;
  });
  return result;
}
