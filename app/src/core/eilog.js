// Real boon uptimes from an Elite Insights JSON log (ArcDPS's log, run through Elite Insights).
const MIGHT = 740;
const FURY = 725;

export function parseEliteInsights(json, characterName) {
  if (!json || !Array.isArray(json.players) || !json.players.length) {
    throw new Error("This doesn't look like an Elite Insights JSON log. In Elite Insights, turn on JSON output and pick the .json file it writes.");
  }
  const want = characterName || json.recordedBy;
  const p = json.players.find(pl => pl.name === want) || json.players[0];
  // Phase 0 is the whole fight. For Might, EI's uptime is the average stack count; for Fury, a percentage.
  const uptime = id => p.buffUptimes?.find(b => b.id === id)?.buffData?.[0]?.uptime ?? null;
  return {
    name: p.name,
    might: uptime(MIGHT) ?? 0,
    fury: (uptime(FURY) ?? 0) / 100,
    players: json.players.map(pl => pl.name),
    fight: json.fightName || json.encounterName || "",
  };
}
