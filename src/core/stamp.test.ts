/** Stamps: equality is order-insensitive and field-exact; readStamp uses git. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { readStamp, stampsEqual } from "./stamp";

test("stampsEqual: exact per-field, order-insensitive, never true against absence", () => {
  const a = { root: "/r1", head: "abc", dirty: "" };
  const b = { root: "/r2", head: "def", dirty: "12ab" };
  assert.equal(stampsEqual([a, b], [b, a]), true);
  assert.equal(stampsEqual([a], [{ ...a, dirty: "x" }]), false);
  assert.equal(stampsEqual([a], [a, b]), false);
  assert.equal(stampsEqual(undefined, [a]), false);
  assert.equal(stampsEqual([a], undefined), false);
});

test("readStamp: clean tree → empty dirty; changes → digest; injectable git", async () => {
  const clean = await readStamp("/repo", async (_root, args) =>
    args[0] === "rev-parse" ? "abc123" : "",
  );
  assert.deepEqual(clean, { root: "/repo", head: "abc123", dirty: "" });

  const dirty = await readStamp("/repo", async (_root, args) =>
    args[0] === "rev-parse" ? "abc123" : args[0] === "status" ? " M src/x.ts" : "1 file changed",
  );
  assert.equal(dirty.head, "abc123");
  assert.ok(dirty.dirty.length > 0, "uncommitted changes fingerprinted");
});
