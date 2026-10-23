// Daily and weekly resets, and countdown text.

const DAY = 24 * 60 * 60_000;

// Daily reset: 00:00 UTC.
export function nextDailyReset(nowMs) {
  return Math.floor(nowMs / DAY) * DAY + DAY;
}

// Weekly reset: Monday 07:30 UTC.
export function nextWeeklyReset(nowMs) {
  const d = new Date(nowMs);
  const daysToMonday = (8 - d.getUTCDay()) % 7;   // Sunday 0 -> 1, Monday 1 -> 0
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToMonday, 7, 30);
  if (t <= nowMs) t += 7 * DAY;
  return t;
}

export function formatCountdown(ms) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
