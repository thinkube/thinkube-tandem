/**
 * INVARIANT: a worker's brief carries the TEP body in one block only — the
 * north-star block — instead of printing the same text twice under two
 * headings. For a CODE unit, buildWorkerPrompt must render the given TEP
 * text exactly once in the returned brief, no matter what other context
 * (slice body, etc.) is threaded alongside it. This must hold forever: any
 * future block that also wants to show "the intent" must reuse the north
 * star rather than re-embed the TEP text under its own heading.
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

function codeUnit(): SchedUnit {
  return {
    id: "SL-1#eu-1",
    slice: "SL-1",
    footprint: ["src/core/docsDuty.ts"],
    requires: [],
    shape: "serial",
    role: "code",
    note: "Implement docsDuty().",
  };
}

test("buildWorkerPrompt renders a code unit's TEP text exactly once", () => {
  const tepBody =
    "# TEP-cmxela-30\nA cut carries its documentation decision, one rule in one place.";
  const brief = buildWorkerPrompt(codeUnit(), "TEP-cmxela-30", {
    sliceBody: "## Your slice\nBuild docsDuty per the contract.",
    tepBody,
  });
  assert.equal(
    countOccurrences(brief, tepBody),
    1,
    "the TEP body text must appear exactly once in a code unit's brief",
  );
});
