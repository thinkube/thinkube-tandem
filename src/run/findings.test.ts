/**
 * What the work noticed and did not do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findingsIn, THE_FINDING_RULE } from "./findings";

test("a finding is lifted from a report, in the words it was written in", () => {
  const said = [
    "I fixed the ordering and the checks are green.",
    "FINDING: the Catalan translation of the priority filter is missing, in frontend/src/locales/ca.json",
    "- FINDING: the due-date field accepts a date in the past without saying anything",
    "UNDELIVERED: none",
  ].join("\n");
  assert.deepEqual(findingsIn(said), [
    "the Catalan translation of the priority filter is missing, in frontend/src/locales/ca.json",
    "the due-date field accepts a date in the past without saying anything",
  ]);
});

test("a report of nothing noticed is not a finding", () => {
  assert.deepEqual(findingsIn("FINDING: none"), []);
  assert.deepEqual(findingsIn("FINDING: nothing — the work was clean."), []);
  assert.deepEqual(findingsIn("no findings here at all"), []);
});

test("the rule says what to do with what is not yours: fix it only when it blocks", () => {
  assert.match(THE_FINDING_RULE, /does it stop this work being delivered/i);
  assert.match(THE_FINDING_RULE, /It does: it is part of the work/);
  assert.match(THE_FINDING_RULE, /It does not: leave it alone/);
});
