import { test } from "node:test";
import assert from "node:assert/strict";
import { boot } from "../src/core/boot.js";

test("a saved key that no longer works falls back to the example and keeps the error", async () => {
  const calls = [];
  const result = await boot({
    savedKey: "OLD-KEY",
    loadKey: async key => { calls.push(["key", key]); return null; },
    loadExample: async opts => { calls.push(["example", opts]); return { source: "example" }; },
  });
  assert.deepEqual(calls, [["key", "OLD-KEY"], ["example", { keepStatus: true }]]);
  assert.equal(result.source, "example");
});

test("no saved key loads the example; a working key loads only the account", async () => {
  const calls = [];
  const loaders = {
    loadKey: async () => { calls.push("key"); return { source: "account" }; },
    loadExample: async () => { calls.push("example"); return { source: "example" }; },
  };
  await boot({ savedKey: null, ...loaders });
  await boot({ savedKey: "GOOD", ...loaders });
  assert.deepEqual(calls, ["example", "key"]);
});
