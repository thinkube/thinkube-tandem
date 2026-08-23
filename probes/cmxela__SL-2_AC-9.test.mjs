// WHY (INVARIANT): the phase table is the one copy of when the host acts.
// This proves the documentation-exemption action is listed in ALLOWED for
// every phase where a cut can still be signed, and absent from running and
// signed — otherwise the surface receives it in no allowed list and the
// control is disabled forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNow } from "../out-test/surfaces/phase.js";

test("allowedNow carries the documentation-exemption action in signable phases and not in running or signed", () => {
  // The phases in which a cut can still be signed, per the phase table's
  // own doc-comment: nothing signed or running yet.
  for (const phase of ["drafting", "read", "understood"]) {
    assert.ok(
      allowedNow(phase).includes("excuse-docs"),
      `excuse-docs must be allowed in phase "${phase}" — a cut can still be signed there`,
    );
  }
  for (const phase of ["running", "signed"]) {
    assert.ok(
      !allowedNow(phase).includes("excuse-docs"),
      `excuse-docs must NOT be allowed in phase "${phase}"`,
    );
  }
});
