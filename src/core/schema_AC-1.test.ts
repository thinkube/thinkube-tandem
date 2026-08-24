/**
 * INVARIANT — a run's identity, minted by runStamp(tep, nowMs), always
 * carries the TEP it belongs to, always differs between two runs of the
 * same TEP taken at different moments, and its `at` is always the ISO form
 * of the moment it was given. Every reader of a run's identity (the run
 * log, the defect rows, the delivery) depends on this holding for good.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runStamp } from "../run/dispatch";

test("runStamp's id carries the TEP and differs across moments; its `at` is the ISO form of the given moment", () => {
  const tep = "TEP-night-4-1";
  const t1 = Date.parse("2026-08-24T10:00:00.000Z");
  const t2 = Date.parse("2026-08-24T10:00:01.000Z");

  const first = runStamp(tep, t1);
  const second = runStamp(tep, t2);

  assert.ok(first.id.includes(tep), `id does not carry the TEP: ${first.id}`);
  assert.ok(second.id.includes(tep), `id does not carry the TEP: ${second.id}`);
  assert.notEqual(first.id, second.id, "two runs of the same TEP at different moments must mint different ids");

  assert.equal(first.at, new Date(t1).toISOString());
  assert.equal(second.at, new Date(t2).toISOString());
});

test("runStamp is total and deterministic: the same TEP and moment always mint the same stamp", () => {
  // runStamp is a pure function of (tep, nowMs) — no disk, no clock read of
  // its own. Two callers handed the same inputs must see the same identity,
  // or a repair pass that recomputes it would silently mint a second
  // spelling of the same run.
  const tep = "TEP-night-4-1";
  const at = Date.parse("2026-08-24T10:00:00.000Z");
  const a = runStamp(tep, at);
  const b = runStamp(tep, at);
  assert.deepEqual(a, b, "same TEP, same moment: the mint is deterministic");
});
