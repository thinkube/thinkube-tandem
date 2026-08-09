/**
 * The closing gate's honesty about WHOSE failure a red is: a runner that
 * could not run at all says nothing about the code, and journalling it as a
 * code defect makes the ledger blame the author for a broken toolchain.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { logRedChecks } from "./assess";

test("a runner that could not run is a gate defect, not the coder's fault", () => {
  const entries: { trigger: string; type?: string; detail: string }[] = [];
  logRedChecks(
    [
      { ac: 1, pass: false, unrunnable: true },
      { ac: 2, pass: false, evidence: "expected 3, got 4" },
      { ac: 3, pass: true },
    ],
    (e) => entries.push(e),
  );
  assert.equal(entries.length, 2, "only the reds are journalled");
  assert.equal(entries[0].trigger, "gate-infra");
  assert.equal(entries[0].type, "gate");
  assert.match(entries[0].detail, /126\/127/);
  assert.equal(entries[1].trigger, "gate-ac", "a real red still lands on the code");
  assert.equal(entries[1].type, "code");
});
