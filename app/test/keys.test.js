import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAll } from "../src/core/keys.js";

test("a key that fails to register releases the ones before it", async () => {
  const live = new Set();
  const register = async accel => { if (accel === "F9") throw new Error("taken"); live.add(accel); };
  const unregister = async accel => { live.delete(accel); };
  await assert.rejects(registerAll([["F7", () => {}], ["F8", () => {}], ["F9", () => {}]], { register, unregister }), /taken/);
  assert.deepEqual([...live], []);
});

test("all keys registered are returned so they can be released later", async () => {
  const live = new Set();
  const got = await registerAll([["F7", () => {}], ["F8", () => {}]], { register: async a => live.add(a), unregister: async a => live.delete(a) });
  assert.deepEqual(got, ["F7", "F8"]);
  assert.deepEqual([...live], ["F7", "F8"]);
});
