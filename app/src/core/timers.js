// Event timers from the Guild Wars 2 Wiki's event timer data (Widget:Event timer/data.json).
// Every event's day starts at 00:00 UTC: the "partial" list plays once, then "pattern" repeats until midnight.

const DAY = 24 * 60 * 60_000;
const MIN = 60_000;

// One day of segments for one event, starting at dayStart and cut off at midnight.
function daySegments(event, dayStart) {
  const { partial = [], pattern = [] } = event.sequences || {};
  const out = [];
  let t = dayStart;
  const end = dayStart + DAY;
  const push = step => {
    const start = t;
    t += step.d * MIN;
    out.push({ r: step.r, start, end: Math.min(t, end) });
  };
  for (const step of partial) { if (t >= end) break; push(step); }
  const patternLength = pattern.reduce((n, s) => n + s.d, 0);
  while (patternLength > 0 && t < end) for (const step of pattern) { if (t >= end) break; push(step); }
  return out;
}

// Every named segment overlapping [fromMs, toMs), across days.
export function occurrences(data, fromMs, toMs) {
  const out = [];
  const firstDay = Math.floor(fromMs / DAY) * DAY;
  for (const [eventId, event] of Object.entries(data.events)) {
    if (!event.name) continue;
    for (let day = firstDay; day < toMs; day += DAY) {
      for (const seg of daySegments(event, day)) {
        if (seg.end <= fromMs || seg.start >= toMs) continue;
        const info = event.segments[seg.r];
        if (!info?.name) continue;
        out.push({
          key: `${eventId}|${seg.start}`, eventId, category: event.category, mapName: event.name,
          name: info.name, chatlink: info.chatlink?.trim() || null, start: seg.start, end: seg.end,
        });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}

// Schedule names -> /v2/worldbosses ids, for "done today".
export const WORLD_BOSS_API_IDS = {
  "Admiral Taidha Covington": "admiral_taidha_covington",
  "Svanir Shaman Chief": "svanir_shaman_chief",
  "Megadestroyer": "megadestroyer",
  "Fire Elemental": "fire_elemental",
  "The Shatterer": "the_shatterer",
  "Great Jungle Wurm": "great_jungle_wurm",
  "Modniir Ulgoth": "modniir_ulgoth",
  "Shadow Behemoth": "shadow_behemoth",
  "Claw of Jormag": "claw_of_jormag",
  "Golem Mark II": "inquest_golem_mark_ii",
  "Triple Trouble": "triple_trouble_wurm",
  "Karka Queen": "karka_queen",
  "Tequatl the Sunless": "tequatl_the_sunless",
  "Drakkar and Spirits of the Wild": "drakkar",
  "Of Mists and Monsters": "mists_and_monsters_titans",
};

// Timer event ids -> /v2/mapchests ids: the map's daily Hero's Choice Chest from its meta.
export const MAPCHEST_EVENT_IDS = {
  "hot-vb": "verdant_brink_heros_choice_chest",
  "hot-ab": "auric_basin_heros_choice_chest",
  "hot-td": "tangled_depths_heros_choice_chest",
  "hot-ds": "dragons_stand_heros_choice_chest",
  "pof-co": "crystal_oasis_heros_choice_chest",
  "pof-er": "elon_riverlands_heros_choice_chest",
  "pof-td": "the_desolation_heros_choice_chest",
  "pof-dv": "domain_of_vabbi_heros_choice_chest",
  "eod-sp": "seitung_province_heros_choice_chest",
  "eod-nkc": "new_kaineng_city_heros_choice_chest",
  "eod-ew": "echovald_wilds_heros_choice_chest",
  "eod-de": "dragons_end_heros_choice_chest",
  "soto-sa": "skywatch_archipelago_heros_choice_chest",
  "soto-am": "amnytas_heros_choice_chest",
  "public-con": "convergence_heros_choice_chest",
};

// Whether an occurrence's daily reward is already claimed today, or null when we can't tell.
export function doneToday(occ, done) {
  if (!done) return null;
  const boss = WORLD_BOSS_API_IDS[occ.name];
  if (boss) return done.worldbosses ? done.worldbosses.has(boss) : null;
  const chest = MAPCHEST_EVENT_IDS[occ.eventId];
  if (chest) return done.mapchests ? done.mapchests.has(chest) : null;
  return null;
}
