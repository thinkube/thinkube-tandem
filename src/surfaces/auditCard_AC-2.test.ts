/**
 * INVARIANT — the audit card must never go green while the slice's own
 * test-maintainer has not finished: unpassedWorkers(units, "SL-1") keeps
 * reporting a `maintain` unit whose slice is "SL-1-tests" for as long as
 * that unit's state is not "done". The maintainer's slice is named
 * "<slice>-tests", a different slice string from the coders' own — a
 * verdict that only looked at units literally tagged "SL-1" would miss it.
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

test("the test-maintainer of SL-1-tests is unpassed until it is done", () => {
  const units: RunUnitLike[] = [
    { id: "SL-1#eu-1", slice: "SL-1", role: "code", state: "done" },
    { id: "SL-1#eu-2", slice: "SL-1", role: "test", state: "done" },
    { id: "SL-1-tests#eu-1", slice: "SL-1-tests", role: "maintain", state: "running" },
  ];

  const unpassed = unpassedWorkers(units, "SL-1");

  assert.ok(
    unpassed.some((u) => u.id === "SL-1-tests#eu-1"),
    "the not-yet-done test-maintainer must still appear in the unpassed list",
  );
});
