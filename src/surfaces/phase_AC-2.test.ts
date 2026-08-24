/**
 * The not-needed reason is recorded before signing, so the host must act
 * on waive-docs in exactly the phases the cut review can be opened in —
 * and must give a reason for refusing it in every other phase.
 *
 * The failures this guards, which fail in opposite directions and neither
 * speaks: a gesture allowed in a phase where the cut review cannot be
 * opened records a waiver against work nobody can read; a gesture refused
 * with no reason leaves a dead control and nothing to show a person for
 * why it will not press.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNow, refusedNow, Phase } from "./phase";

const PHASES: readonly Phase[] = [
  "drafting",
  "read",
  "understood",
  "signed",
  "running",
  "delivered",
];

// INVARIANT: waive-docs is on in a phase exactly when open-cut-review is.
// Anchored to the sibling gesture rather than to a spelled list, because
// the criterion is "where the cut review can be opened" — if that set
// moves, the waiver must move with it.
test("waive-docs is allowed in exactly the phases that can open the cut review", () => {
  const opens = PHASES.filter((p) => allowedNow(p).includes("open-cut-review"));
  const waives = PHASES.filter((p) => allowedNow(p).includes("waive-docs"));
  assert.notDeepEqual(opens, [], "no phase can open the cut review — the anchor is gone");
  assert.deepEqual(waives, opens);
});

// INVARIANT: in every phase that does NOT allow it, refusedNow returns a
// non-empty reason. A refusal with nothing to say is the dead-control
// failure this table exists to prevent.
test("every phase that refuses waive-docs gives a reason for refusing it", () => {
  for (const phase of PHASES) {
    const allowed = allowedNow(phase).includes("waive-docs");
    const why = refusedNow("waive-docs", phase);
    if (allowed) {
      assert.equal(why, undefined, `${phase} allows waive-docs but also refuses it`);
    } else {
      assert.equal(typeof why, "string", `${phase} refuses waive-docs with no reason`);
      assert.notEqual((why ?? "").trim(), "", `${phase} refuses waive-docs with an empty reason`);
    }
  }
});
