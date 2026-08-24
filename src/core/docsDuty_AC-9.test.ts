/**
 * There must be exactly one rule for what counts as a documentation path,
 * exported once from src/core/docsDuty.ts — not a docs/ prefix test
 * duplicated at both the cut-level duty and the per-slice obligation
 * check, which could silently drift apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocsPath } from "./docsDuty";

// TRANSITION: isDocsPath is new in this slice — the predicate docsDutyOf
// itself is built on. This proves the predicate is exported and behaves as
// the one definition of a documentation path: true under docs/, false
// elsewhere.
test("isDocsPath is exported from src/core/docsDuty.ts and accepts a docs/ path", () => {
  assert.equal(typeof isDocsPath, "function");
  assert.equal(isDocsPath("docs/modules/ROOT/pages/gates.adoc"), true);
});

test("isDocsPath rejects a path outside docs/", () => {
  assert.equal(isDocsPath("src/core/docsDuty.ts"), false);
});
