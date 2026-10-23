// The Guild Wars 2 API client. Keys are only ever sent to api.guildwars2.com.

export const API = "https://api.guildwars2.com/v2";

export class UserError extends Error {}

let fetchImpl = (...args) => fetch(...args);
// Swaps the transport; tests use it to replay recorded responses.
export function setFetch(fn) { fetchImpl = fn; }

export async function getJSON(path, params = {}, { auth = false } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try { res = await fetchImpl(url); }
  catch { throw new UserError("Couldn't reach the Guild Wars 2 API. Check your internet connection and try again."); }
  let body = null;
  try { body = await res.json(); } catch { /* error pages aren't JSON */ }
  if (res.ok) return body;                                   // 200, and 206 when some ids were unknown
  const text = (body && body.text) || "";
  if (res.status === 404 && /all ids provided are invalid/i.test(text)) return [];
  if (auth && res.status === 401) throw new UserError("ArenaNet didn't accept this API key. Copy the whole key from your ArenaNet account page and try again.");
  if (auth && res.status === 403) throw new UserError("This key isn't allowed to read that. Create a key with the permissions listed in Settings.");
  if (res.status === 429) throw new UserError("The API is limiting requests right now. Wait a minute, then try again.");
  throw new UserError(`The Guild Wars 2 API answered with an error (${res.status}${text ? `: ${text}` : ""}). It is sometimes down after a game update. Try again in a few minutes.`);
}

// Fetches ids in chunks of 200 through a small pool of workers, so one slow response doesn't hold up the rest.
export async function getMany(path, ids, { concurrency = 4, onProgress } = {}) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const results = new Array(chunks.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await getJSON(path, { ids: chunks[i].join(","), lang: "en" });
      onProgress?.(++done, chunks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return results.flatMap(r => r || []);
}

// localStorage that never throws, and does nothing where there is none (tests, locked-down webviews).
export const store = {
  get(k) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
  set(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* storage blocked */ } },
  del(k) { try { globalThis.localStorage?.removeItem(k); } catch { /* storage blocked */ } },
};
