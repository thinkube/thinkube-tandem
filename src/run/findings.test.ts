/**
 * What the work noticed and did not do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findingsIn, THE_FINDING_RULE } from "./findings";

test("a finding is lifted as a pair: what was seen, and the ask drafted for it", () => {
  const said = [
    "I fixed the ordering and the checks are green.",
    "FINDING: the Catalan translation of the priority filter is missing, in ca.json | ASK: The priority filter reads in Catalan when the page is in Catalan.",
    "- FINDING: the due-date field accepts a date in the past without saying anything",
    "UNDELIVERED: none",
  ].join("\n");
  assert.deepEqual(findingsIn(said), [
    {
      saw: "the Catalan translation of the priority filter is missing, in ca.json",
      ask: "The priority filter reads in Catalan when the page is in Catalan.",
    },
    { saw: "the due-date field accepts a date in the past without saying anything" },
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
  assert.match(THE_FINDING_RULE, /ASK: <one/, "and whoever saw it drafts the ask");
});
