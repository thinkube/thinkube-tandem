/**
 * INVARIANT: a worker's brief carries the TEP body in one block only — the
 * north-star block — instead of printing the same text twice under two
 * headings. This must hold for a TEST unit (role "test") exactly as it does
 * for a code unit: the same TEP text, threaded through the same
 * buildWorkerPrompt call, must occur exactly once in the rendered brief.
 * The test-author role renders extra blocks (contract, example test) that a
 * code unit does not, so this is checked independently rather than assumed
 * to follow from the code-unit case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "./preflight";
import { SchedUnit } from "./dag";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    count++;
    from = i + needle.length;
  }
  return count;
}

function testUnit(): SchedUnit {
  return {
    id: "SL-1#eu-2",
    slice: "SL-1",
    footprint: ["src/core/docsDuty.test.ts"],
    requires: [],
    shape: "serial",
    role: "test",
    note: "Assert docsDuty()'s three states.",
  };
}

test("buildWorkerPrompt renders a test unit's TEP text exactly once", () => {
  const tepBody =
    "# TEP-cmxela-30\nA cut carries its documentation decision, one rule in one place.";
  const brief = buildWorkerPrompt(testUnit(), "TEP-cmxela-30", {
    sliceBody: "## Your slice\nWrite docsDuty()'s acceptance tests.",
    tepBody,
    testConvention:
      "node:test ESM modules run directly with `node --test <file>`",
  });
  assert.equal(
    countOccurrences(brief, tepBody),
    1,
    "the TEP body text must appear exactly once in a test unit's brief",
  );
});
