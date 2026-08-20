// WHY (TRANSITION): the documentation-exemption action must be added to the
// one phase table so the host acts on it exactly while a cut can still be
// signed — proves it is allowed in "understood" (the signable phase) and
// refused once a run is in flight or the cut is already signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedNow } from "../out-test/surfaces/phase.js";

test("allowedNow returns the documentation-exemption action where a cut can still be signed, and not in running or signed", () => {
  assert.ok(
    allowedNow("understood").includes("excuse-docs"),
    "excusing documentation must be allowed while a cut is still signable ('understood')",
  );
  assert.ok(
    !allowedNow("running").includes("excuse-docs"),
    "excusing documentation must not be allowed while a run is in flight",
  );
  assert.ok(
    !allowedNow("signed").includes("excuse-docs"),
    "excusing documentation must not be allowed once the cut is already signed",
  );
});
