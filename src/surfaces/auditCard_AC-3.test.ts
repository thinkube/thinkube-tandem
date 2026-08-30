/**
 * INVARIANT — a worker that has failed or is blocked is never counted as
 * passed: unpassedWorkers(units, "SL-1") reports a unit whose state is
 * "failed" and a unit whose state is "blocked" alongside each other, so
 * the audit card cannot go green while either kind of stall sits in the
 * slice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unpassedWorkers } from "./auditCard";

interface RunUnitLike {
  id: string;
  slice: string;
  role: "code" | "test" | "maintain";
  state: string;
}

test("a failed unit and a blocked unit both come back as unpassed", () => {
  const units: RunUnitLike[] = [
    { id: "SL-1#eu-1", slice: "SL-1", role: "code", state: "failed" },
    { id: "SL-1#eu-2", slice: "SL-1", role: "code", state: "blocked" },
    { id: "SL-1#eu-3", slice: "SL-1", role: "test", state: "done" },
  ];

  const unpassed = unpassedWorkers(units, "SL-1");
  const ids = unpassed.map((u) => u.id);

  assert.ok(ids.includes("SL-1#eu-1"), "the failed unit must appear in the unpassed list");
  assert.ok(ids.includes("SL-1#eu-2"), "the blocked unit must appear in the unpassed list");
});
