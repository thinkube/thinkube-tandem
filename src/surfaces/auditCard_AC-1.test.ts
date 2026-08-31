/**
 * INVARIANT — the audit card must never go green while the slice's own
 * tester is still working: unpassedWorkers keeps reporting a `test` unit
 * of the slice for as long as its state is "running", even once every
 * `code` unit of that slice already reads "done". A verdict built only
 * from coders would call the slice passed while the tester is mid-run.
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

test("the slice's test unit is still unpassed while it is running, even with every coder done", () => {
  const units: RunUnitLike[] = [
    { id: "SL-1#eu-1", slice: "SL-1", role: "code", state: "done" },
    { id: "SL-1#eu-2", slice: "SL-1", role: "code", state: "done" },
    { id: "SL-1#eu-3", slice: "SL-1", role: "test", state: "running" },
  ];

  const unpassed = unpassedWorkers(units, "SL-1");

  assert.ok(
    unpassed.some((u) => u.id === "SL-1#eu-3"),
    "the running tester must still appear in the unpassed list",
  );
});
