/**
 * The phase table: a control is allowed exactly in the phases the host
 * would act on it, and a press outside those phases is refused with a
 * reason — never let through unqueried.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { allowedNow, refusedNow } from "./phase";

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

test("refusedNow names why the documentation-exemption action is refused in a phase where signing is not possible", () => {
  const reason = refusedNow("excuse-docs", "running");
  assert.ok(
    typeof reason === "string" && reason.length > 0,
    "refusedNow must name a reason when a run is in flight, not let the action through unqueried",
  );
});
