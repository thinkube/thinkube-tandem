/**
 * TRANSITION — newRunId does not exist yet: a run's identity is minted from
 * the TEP it runs and the moment it starts, so every delivery that run
 * produces can be traced back to the run that produced it. This proves the
 * mint itself, once, ahead of anything that calls it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newRunId } from "../run/dispatch";

test("newRunId carries the TEP it was minted for, and two calls at different times differ", () => {
  const a = newRunId("TEP-headless-1", 1_000);
  const b = newRunId("TEP-headless-1", 2_000);
  assert.match(a, /TEP-headless-1/, "the id names the TEP it was minted for");
  assert.match(b, /TEP-headless-1/, "same for the second call");
  assert.notEqual(a, b, "two calls minted at different times return different ids");
});
