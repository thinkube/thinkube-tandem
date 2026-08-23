/**
 * refusedNow names why the action is refused in a phase where signing is not
 * possible, instead of letting it through unqueried.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusedNow, allowedNow } from "../surfaces/phase";

test("refusedNow names why excuse-docs is refused where signing is not possible", () => {
  for (const phase of ["running", "signed"] as const) {
    const why = refusedNow("excuse-docs", phase);
    assert.ok(
      why && why.trim().length > 0,
      `refusedNow must name a reason for excuse-docs in ${phase}, never return nothing`,
    );
  }

  assert.match(
    refusedNow("excuse-docs", "running")!,
    /run is in flight/i,
    "the refusal in running must say a run is in flight",
  );
  assert.match(
    refusedNow("excuse-docs", "signed")!,
    /signed work is waiting/i,
    "the refusal in signed must say signed work is waiting to run",
  );

  // Where it is allowed, there is nothing to refuse.
  for (const phase of ["drafting", "read", "understood"] as const) {
    assert.ok(allowedNow(phase).includes("excuse-docs"));
    assert.equal(
      refusedNow("excuse-docs", phase),
      undefined,
      `excuse-docs is allowed in ${phase}, so nothing may be refused`,
    );
  }
});
