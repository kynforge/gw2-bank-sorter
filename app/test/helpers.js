// Test helpers: replay recorded API responses so tests never touch the network.
import { readFileSync } from "node:fs";

const FIXTURE = new URL("./fixtures/example-catalog.json", import.meta.url);

export function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

// A fetch that answers from the recorded responses, and fails loudly for anything unrecorded.
export function replayFetch(recorded = loadFixture()) {
  return async url => {
    const key = String(url);
    if (!(key in recorded)) return new Response(JSON.stringify({ text: `not recorded: ${key}` }), { status: 599 });
    const { status, body } = recorded[key];
    return new Response(JSON.stringify(body), { status });
  };
}

// A fetch built from a path → body map, for hand-made scenarios. Unknown paths answer 404.
export function fakeFetch(routes) {
  return async url => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/v2/, "");
    for (const [pattern, body] of Object.entries(routes)) {
      if (pattern === path || (pattern.endsWith("*") && path.startsWith(pattern.slice(0, -1)))) {
        const value = typeof body === "function" ? body(u) : body;
        if (value instanceof Response) return value;
        return new Response(JSON.stringify(value), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ text: "no such endpoint" }), { status: 404 });
  };
}
