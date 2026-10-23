// Picks a stat set for each gear slot to suit a goal. It's an estimate: it models attributes, crits,
// condition ticks and boon duration, but not traits, sigil procs or skill coefficients.
import { itemStat, addAttrs, derived, DEFAULT_ASSUMPTIONS } from "./stats.js";

export const GOALS = [
  { id: "power", name: "Power damage",
    stats: ["Berserker's", "Assassin's", "Dragon's", "Marauder", "Valkyrie", "Diviner's", "Commander's"] },
  { id: "condi", name: "Condition damage",
    stats: ["Viper's", "Sinister", "Grieving", "Rabid", "Dire", "Carrion", "Ritualist's", "Trailblazer's", "Seraph", "Celestial", "Plaguedoctor's", "Bringer's"] },
  { id: "hybrid", name: "Power and condition",
    stats: ["Viper's", "Grieving", "Sinister", "Rampager's", "Berserker's", "Assassin's", "Celestial", "Marshal's"] },
  { id: "boonDps", name: "Boon support with power damage",
    stats: ["Berserker's", "Assassin's", "Diviner's", "Commander's", "Dragon's", "Valkyrie", "Wanderer's", "Vigilant", "Harrier's"] },
  { id: "healer", name: "Boon support with healing",
    stats: ["Harrier's", "Minstrel's", "Magi's", "Cleric's", "Nomad's", "Ritualist's", "Plaguedoctor's", "Seraph", "Diviner's", "Zealot's", "Apothecary's", "Wanderer's", "Marshal's", "Giver's"] },
];
const NEEDS_BOON = new Set(["boonDps", "healer"]);

// Damage per stack per second at level 80: base + coefficient × Condition Damage (torment while the target stands still).
export const CONDITIONS = {
  bleeding: { name: "Bleeding", base: 22, coef: 0.06 },
  burning: { name: "Burning", base: 131, coef: 0.155 },
  poison: { name: "Poison", base: 33.5, coef: 0.06 },
  torment: { name: "Torment", base: 31.8, coef: 0.09 },
  confusion: { name: "Confusion", base: 18.25, coef: 0.05 },
};

export const powerScore = d => d.power * (1 + (d.critChance / 100) * (d.critDamage / 100 - 1));
export const condiScore = (d, condition = "bleeding") => {
  const c = CONDITIONS[condition] || CONDITIONS.bleeding;
  return (c.base + c.coef * d.condiDamage) * (1 + d.condDuration / 100);
};

// opts: condition (condi, hybrid), weight 0–1 power share (hybrid), refs (hybrid), minBoon % (boonDps, healer).
// Condition builds still want some Power and Precision (crits trigger procs, and there's always some
// direct damage), so the condition goal counts power damage at 15%.
const CONDI_POWER_SHARE = 0.15;

export function score(d, goal, opts = {}) {
  switch (goal) {
    case "condi": return score(d, "hybrid", { ...opts, weight: CONDI_POWER_SHARE });
    case "hybrid": {
      const w = opts.weight ?? 0.5;
      const refs = opts.refs || { power: 1000, condi: condiScore({ condiDamage: 0, condDuration: 0 }, opts.condition) };
      return w * powerScore(d) / refs.power + (1 - w) * condiScore(d, opts.condition) / refs.condi;
    }
    case "healer": return d.healing;
    default: return powerScore(d);
  }
}

// Scores for the bare character, so hybrid weighs power and conditions on the same footing.
export function hybridRefs(base, assumptions = DEFAULT_ASSUMPTIONS, condition) {
  const d = derived(base, assumptions);
  return { power: powerScore(d), condi: condiScore(d, condition) };
}

const attrKey = attrs => Object.keys(attrs).sort().map(k => `${k}:${attrs[k]}`).join(",");

// Beam search over slots, biggest first. A minimum boon duration is enforced with a penalty that only
// counts what the remaining slots could no longer make up.
export function optimize({ slots, base, goal, opts = {}, assumptions = DEFAULT_ASSUMPTIONS, beam = 2000 }) {
  const o = goal === "hybrid" || goal === "condi" ? { ...opts, refs: opts.refs || hybridRefs(base, assumptions, opts.condition) } : opts;
  const order = [...slots].sort((a, b) => b.adj - a.adj);
  const options = order.map(s => s.choices.map(c => ({ id: c.id, attrs: itemStat(s.adj, c) })));
  const minBoon = NEEDS_BOON.has(goal) ? (opts.minBoon || 0) : 0;
  const boonLeft = new Array(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) boonLeft[i] = boonLeft[i + 1] + Math.max(0, ...options[i].map(c => c.attrs.BoonDuration || 0));

  const evaluate = (attrs, remaining) => {
    const d = derived(attrs, assumptions);
    const reach = Math.min(100, ((attrs.BoonDuration || 0) + ((assumptions.flat || {}).BoonDuration || 0) + remaining) / 15 + (assumptions.boonDuration || 0));
    return score(d, goal, o) - Math.max(0, minBoon - reach) * 1e6;
  };

  let states = [{ attrs: { ...base }, picks: {} }];
  order.forEach((slot, i) => {
    const next = new Map();
    for (const st of states) {
      for (const c of options[i]) {
        const attrs = addAttrs(st.attrs, c.attrs);
        const key = attrKey(attrs);
        if (!next.has(key)) next.set(key, { attrs, picks: { ...st.picks, [slot.slot]: c.id } });
      }
    }
    states = [...next.values()]
      .map(st => ({ ...st, s: evaluate(st.attrs, boonLeft[i + 1]) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, beam);
  });

  const best = states[0];
  const d = derived(best.attrs, assumptions);
  return { picks: best.picks, attrs: best.attrs, derived: d, score: score(d, goal, o), unmet: minBoon > 0 && d.boonDuration < minBoon };
}
