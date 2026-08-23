// WHY (INVARIANT): a phase where signing is not possible must name why the
// documentation-exemption action is refused, rather than letting it through
// unqueried — the phase table is the single place that decision is made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusedNow } from "../out-test/surfaces/phase.js";

test("refusedNow names why excuse-docs is refused in a phase where signing is not possible", () => {
  const reason = refusedNow("excuse-docs", "running");
  assert.ok(
    reason && reason.trim().length > 0,
    "refusedNow must name a reason for excuse-docs in a phase where signing cannot happen",
  );
  const reasonSigned = refusedNow("excuse-docs", "signed");
  assert.ok(
    reasonSigned && reasonSigned.trim().length > 0,
    "refusedNow must also name a reason for excuse-docs once a cut is already signed",
  );
});
