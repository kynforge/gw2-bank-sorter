// Records the live API responses the example account needs, so tests replay them offline.
// Run from app/: node scripts/record-fixtures.mjs
import { writeFileSync } from "node:fs";
import { setFetch, getJSON } from "../src/core/api.js";
import { loadExample } from "../src/core/account.js";

const recorded = {};
setFetch(async url => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  recorded[String(url)] = { status: res.status, body };
  return new Response(JSON.stringify(body), { status: res.status });
});

await loadExample();
// The Builds panel also needs every stat combination and the legendary reference items.
await getJSON("/itemstats", { ids: "all", lang: "en" });
const armory = await getJSON("/legendaryarmory", { ids: "all" });
const ids = armory.map(a => a.id);
for (let i = 0; i < ids.length; i += 200) await getJSON("/items", { ids: ids.slice(i, i + 200).join(","), lang: "en" });

writeFileSync(new URL("../test/fixtures/example-catalog.json", import.meta.url), JSON.stringify(recorded));
console.log(`recorded ${Object.keys(recorded).length} responses`);
