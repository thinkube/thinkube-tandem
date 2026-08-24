/**
 * A cut that writes no documentation is not automatically refused: a
 * recorded reason waives the duty, and that reason must ride along in the
 * report so the cut review and TEP body can show why none was needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsDutyOf } from "./docsDuty";
import type { Change } from "./schema";

function changeGroundedAt(...paths: string[]): Change {
  return {
    id: "n1",
    sentence: "a change",
    serves: [],
    needs: [],
    grounding: { touchpoints: paths.map((path) => ({ path })), stamp: [] },
    acceptance: [],
  };
}

// TRANSITION: docsDutyOf is new in this slice. This proves its second duty:
// no docs/ touchpoint anywhere, but a waiver with a reason, reports waived
// and carries that reason.
test("docsDutyOf reports waived, carrying the reason, when no member grounds docs/ and a waiver is passed", () => {
  const members = [changeGroundedAt("src/x.ts")];
  const duty = docsDutyOf(members, { reason: "internal refactor, no user-facing change", at: "2026-08-22T00:00:00Z" });
  assert.equal(duty.status, "waived");
  assert.ok(
    "reason" in duty && duty.reason === "internal refactor, no user-facing change",
    `expected the waiver reason on the report, got ${JSON.stringify(duty)}`,
  );
});

// INVARIANT: the waiver applies to the whole cut, so it still reports
// waived even when there are several members, none grounding docs/.
test("docsDutyOf reports waived across multiple members when none grounds docs/", () => {
  const members = [changeGroundedAt("src/a.ts"), changeGroundedAt("src/b.ts")];
  const duty = docsDutyOf(members, { reason: "no docs needed", at: "2026-08-22T00:00:00Z" });
  assert.equal(duty.status, "waived");
});
