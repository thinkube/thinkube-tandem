/**
 * A cut that writes no documentation and offers no reason not to must be
 * reported as unmet — this is the state that later makes signCut refuse
 * the cut, so the plain "neither documented nor excused" case must resolve
 * to its own distinct status.
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

// TRANSITION: docsDutyOf is new in this slice. This proves its third duty:
// no docs/ touchpoint and no waiver at all reports unmet.
test("docsDutyOf reports unmet when no member grounds docs/ and no waiver is passed", () => {
  const duty = docsDutyOf([changeGroundedAt("src/x.ts")]);
  assert.equal(duty.status, "unmet");
});

// INVARIANT: an empty member list (a cut with no members' grounding to
// inspect) still resolves to unmet rather than throwing or defaulting to
// documented — there is nothing to call documentation.
test("docsDutyOf reports unmet for an empty member list with no waiver", () => {
  const duty = docsDutyOf([]);
  assert.equal(duty.status, "unmet");
});

// INVARIANT: a member with no grounding at all (grounding absent) behaves
// the same as one grounded only outside docs/ — still unmet, not a crash.
test("docsDutyOf reports unmet when a member has no grounding at all", () => {
  const ungrounded: Change = {
    id: "n1",
    sentence: "a change",
    serves: [],
    needs: [],
    acceptance: [],
  };
  const duty = docsDutyOf([ungrounded]);
  assert.equal(duty.status, "unmet");
});
