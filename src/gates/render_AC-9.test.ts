/**
 * allowedNow returns the documentation-exemption action in the phases where
 * a cut can still be signed, and not in running or signed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNow } from "../surfaces/phase";

test("excuse-docs is allowed exactly where a cut can still be signed", () => {
  // Before anything is signed or running, an exemption can still be typed
  // and spent by the next signature.
  for (const phase of ["drafting", "read", "understood"] as const) {
    assert.ok(
      allowedNow(phase).includes("excuse-docs"),
      `excuse-docs must be allowed in ${phase} — a cut can still be signed there`,
    );
  }

  // Once signed or running, the signature it would have fed is already spent
  // or in flight.
  for (const phase of ["running", "signed"] as const) {
    assert.ok(
      !allowedNow(phase).includes("excuse-docs"),
      `excuse-docs must not be allowed in ${phase}`,
    );
  }
});
