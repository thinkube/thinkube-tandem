/**
 * INVARIANT — the audit card goes green exactly when there is nothing
 * left unpassed: unpassedWorkers(units, "SL-1") returns an empty list
 * once every code, test and maintain worker of the slice (and its
 * "SL-1-tests" maintainer slice) reads "done".
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

test("nothing is unpassed once every worker of the slice, including the maintainer, is done", () => {
  const units: RunUnitLike[] = [
    { id: "SL-1#eu-1", slice: "SL-1", role: "code", state: "done" },
    { id: "SL-1#eu-2", slice: "SL-1", role: "code", state: "done" },
    { id: "SL-1#eu-3", slice: "SL-1", role: "test", state: "done" },
    { id: "SL-1-tests#eu-1", slice: "SL-1-tests", role: "maintain", state: "done" },
    // A different slice's unpassed unit must never leak into SL-1's verdict.
    { id: "SL-2#eu-1", slice: "SL-2", role: "code", state: "failed" },
  ];

  const unpassed = unpassedWorkers(units, "SL-1");

  assert.deepEqual(unpassed, [], "an all-done slice must report nothing unpassed");
});
