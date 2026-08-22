/**
 * The phase table is the one place that decides when the host acts on a
 * control: allowedNow must carry the documentation-exemption action in
 * every phase where a cut can still be signed, and never in running or
 * signed — and refusedNow must name why, rather than letting it through
 * unqueried, in a phase where signing is not possible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNow, refusedNow } from "./phase";

test("allowedNow carries the documentation-exemption action in signable phases and not in running or signed", () => {
  // The phases in which a cut can still be signed, per the phase table's
  // own doc-comment: nothing signed or running yet.
  for (const phase of ["drafting", "read", "understood"] as const) {
    assert.ok(
      allowedNow(phase).includes("excuse-docs"),
      `excuse-docs must be allowed in phase "${phase}" — a cut can still be signed there`,
    );
  }
  for (const phase of ["running", "signed"] as const) {
    assert.ok(
      !allowedNow(phase).includes("excuse-docs"),
      `excuse-docs must NOT be allowed in phase "${phase}"`,
    );
  }
});

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
