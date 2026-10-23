// The built-in example account: made-up contents with real item ids, so every panel can be tried without a key.

export const EXAMPLE = {
  capacity: 1000,
  storage: { 19721: 400, 24277: 1000, 46731: 1000, 19700: 1000, 19722: 900, 19976: 120, 70820: 600, 19675: 77,
             12138: 40, 48807: 10, 66650: 300, 24295: 950, 68063: 20, 36041: 1000, 46681: 240 },
  slots: {
    0: [30684, 1, { binding: "Account", upgrades: [24615], infusions: [49424] }],
    1: [46762, 1, { binding: "Account", upgrades: [72339] }],
    2: [19721, 87], 3: [24836, 6], 4: [1094, 1], 6: [8920, 14],
    7: [43766, 17, { binding: "Account" }], 8: [24277, 250], 9: [20356, 1], 10: [9476, 38], 11: [24615, 3],
    13: [36038, 212], 14: [24361, 9, { binding: "Character", bound_to: "Example Character" }], 15: [19976, 38],
    16: [1059, 1], 17: [12452, 25], 18: [24836, 2], 19: [46731, 250, { binding: "Account" }], 21: [20215, 1],
    22: [77302, 9, { binding: "Account" }], 23: [9443, 40], 24: [19700, 250],
    26: [67807, 2, { binding: "Character", bound_to: "Example Character" }], 27: [39612, 1, { binding: "Account" }],
    28: [9476, 12], 29: [19722, 173],
    30: [9185, 1], 31: [70820, 180], 32: [1111, 1], 33: [49428, 2], 34: [23045, 1, { charges: 187, binding: "Account" }],
    35: [38506, 1, { binding: "Account" }], 37: [20323, 17], 38: [19675, 12, { binding: "Account" }], 39: [72339, 1],
    40: [74326, 2], 42: [1070, 1], 43: [86094, 140, { binding: "Account" }], 44: [20276, 1, { binding: "Account" }],
    45: [9383, 1, { binding: "Account" }], 46: [36841, 10], 47: [12138, 31], 49: [48807, 22], 50: [66650, 60],
    51: [100, 1], 52: [24838, 4], 53: [46647, 1, { binding: "Account" }], 54: [77223, 1, { binding: "Account" }],
    55: [9579, 1], 56: [19980, 3, { binding: "Account" }], 58: [24295, 4], 59: [46644, 1],
    60: [67027, 1, { binding: "Account" }], 61: [68063, 4], 62: [44641, 1, { binding: "Account" }], 63: [36041, 250],
    64: [36041, 140], 65: [9443, 25], 66: [49424, 5], 67: [24687, 1], 68: [1128, 1], 69: [8920, 6],
    75: [12452, 10], 80: [43766, 3, { binding: "Account" }],
    92: [48884, 3], 100: [46681, 25, { binding: "Account" }],
  },
  size: 120,
  // Pretend unlocks: Abyss Dye, Mini Liadri, the Primeval Warboots and King Toad's Backpack Cover skins, one shoulder skin.
  owned: { dyes: [473], minis: [170], recipes: [], skins: [1102, 2361, 86] },
  // Real collections with made-up progress: Luminescent Footwear needs the Laces, Utility Utilizer needs a
  // Master Tuning Crystal, Style Guide is finished, and the Mini Lynx would count toward a mini collection.
  collections: [
    { id: 1779, bits: [0, 1, 2] }, { id: 1729, bits: [2] }, { id: 1715, done: true }, { id: 1708, bits: [0, 1, 2, 3] },
  ],
  shared: [[78599, 1, { binding: "Account" }], [19980, 2, { binding: "Account" }], null],
  characters: [
    { name: "Example Mesmer", profession: "Mesmer", bags: [
      { id: 8932, size: 20, slots: { 0: [20215, 1], 1: [9383, 1, { binding: "Account" }], 2: [24277, 12], 3: [9476, 6],
        4: [1059, 1], 5: [43766, 1, { binding: "Account" }] } },
      null,
      { id: 9579, size: 18, slots: { 0: [70820, 20] } },
    ] },
    { name: "Example Warrior", profession: "Warrior", bags: [
      { id: 8932, size: 20, slots: { 0: [44602, 1, { binding: "Account" }], 1: [19721, 13], 2: [19700, 60], 3: [8920, 3],
        4: [24361, 5, { binding: "Character", bound_to: "Example Warrior" }], 5: [1141, 1], 6: [9443, 10], 7: [9443, 5],
        8: [12452, 5], 9: [20323, 4] } },
      { id: 9579, size: 18, slots: { 0: [19976, 2], 1: [19722, 40], 2: [20356, 1], 3: [36038, 30] } },
    ],
    // Legendary gear in a half-Valkyrie, half-Berserker mix, so the optimizer has something to suggest.
    // [slot, item id, itemstat id, upgrades]
    equipment: [
      ["Helm", 80384, 157, [24836]], ["Shoulders", 84181, 157, [24836]], ["Coat", 80254, 161, [24836]],
      ["Gloves", 82410, 161, [24836]], ["Leggings", 84748, 161, [24836]], ["Boots", 83094, 161, [24836]],
      ["WeaponA1", 90551, 161, [24615]], ["WeaponB1", 30684, 161, [24615]], ["WeaponB2", 79802, 157, []],
      ["Backpack", 77474, 1119, []], ["Amulet", 95380, 584, []], ["Ring1", 93105, 1119, []], ["Ring2", 93105, 1119, []],
      ["Accessory1", 91048, 586, []], ["Accessory2", 91048, 586, []],
    ] },
  ],
  // Made-up "done today" progress for the Today panel.
  done: { worldbosses: ["shadow_behemoth", "the_shatterer"], mapchests: ["auric_basin_heros_choice_chest"], dailycrafting: ["glob_of_elder_spirit_residue"] },
  vault: {
    daily: { meta_progress_current: 2, meta_progress_complete: 4, meta_reward_astral: 20, meta_reward_claimed: false, objectives: [
      { id: 1, title: "Complete 3 events", track: "PvE", acclaim: 10, progress_current: 3, progress_complete: 3, claimed: true },
      { id: 2, title: "Salvage 10 items", track: "PvE", acclaim: 10, progress_current: 4, progress_complete: 10, claimed: false },
      { id: 3, title: "Defeat a world boss", track: "PvE", acclaim: 10, progress_current: 1, progress_complete: 1, claimed: false },
      { id: 4, title: "Gather 20 resources", track: "PvE", acclaim: 10, progress_current: 7, progress_complete: 20, claimed: false },
    ] },
    weekly: { meta_progress_current: 3, meta_progress_complete: 8, meta_reward_astral: 290, meta_reward_claimed: false, objectives: [
      { id: 10, title: "Complete 5 meta events", track: "PvE", acclaim: 50, progress_current: 2, progress_complete: 5, claimed: false },
      { id: 11, title: "Defeat 10 world bosses", track: "PvE", acclaim: 50, progress_current: 10, progress_complete: 10, claimed: true },
    ] },
    special: { objectives: [] },
  },
};

const toSlot = entry => entry ? { id: entry[0], count: entry[1], ...(entry[2] || {}) } : null;

export function exampleData() {
  const bank = new Array(EXAMPLE.size).fill(null);
  for (const [i, entry] of Object.entries(EXAMPLE.slots)) bank[+i] = toSlot(entry);
  const characters = EXAMPLE.characters.map(c => ({
    name: c.name,
    profession: c.profession,
    level: 80,
    bags: c.bags.map(b => b && { id: b.id, size: b.size, inventory: Array.from({ length: b.size }, (_, i) => toSlot(b.slots[i])) }),
    equipment: (c.equipment || []).map(([slot, id, stat, upgrades]) => ({ id, slot, stats: { id: stat }, upgrades, binding: "Account", location: "Equipped" })),
  }));
  return { bank, shared: EXAMPLE.shared.map(toSlot), characters };
}
