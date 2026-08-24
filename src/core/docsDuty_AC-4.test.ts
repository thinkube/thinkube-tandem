/**
 * docsWaiverFrom is the one place that decides whether typed text counts as
 * a real reason: blank or whitespace-only input must not silently waive the
 * documentation duty, and real text must be carried forward with its
 * timestamp so the waiver is dated like every other recorded act.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsWaiverFrom } from "./docsDuty";

// TRANSITION: docsWaiverFrom is new in this slice. This proves it refuses
// to mint a waiver from empty or whitespace-only text.
test("docsWaiverFrom returns undefined for an empty reason", () => {
  assert.equal(docsWaiverFrom("", "2026-08-22T00:00:00Z"), undefined);
});

test("docsWaiverFrom returns undefined for a whitespace-only reason", () => {
  assert.equal(docsWaiverFrom("   \n\t  ", "2026-08-22T00:00:00Z"), undefined);
});

// INVARIANT: real text mints a waiver carrying that reason and the given
// timestamp — the pair the cut record keeps.
test("docsWaiverFrom returns the reason and timestamp for a non-empty reason", () => {
  const w = docsWaiverFrom("no user-facing change", "2026-08-22T00:00:00Z");
  assert.deepEqual(w, { reason: "no user-facing change", at: "2026-08-22T00:00:00Z" });
});
