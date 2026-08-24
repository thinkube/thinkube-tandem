/**
 * The run used to hand the same rendered TEP text to buildWorkerPrompt under
 * two different context fields (tepBody and specBody), so a distinctive line
 * from that text showed up twice in the brief. A worker's brief must carry
 * the TEP text once, no matter which other body field a caller also fills
 * with the same text.
 *
 * STANDING INVARIANT — buildWorkerPrompt never duplicates a line supplied via
 * tepBody, even when a caller also supplies the same text as another body
 * field (e.g. sliceBody).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "./preflight";
import { SchedUnit } from "./dag";

const baseUnit: SchedUnit = {
  id: "SL-1#eu-1",
  slice: "SL-1",
  footprint: ["src/a.ts"],
  requires: [],
  shape: "serial",
  role: "code",
  note: "do the thing",
};

test("buildWorkerPrompt returns a brief with the distinctive tepBody line appearing exactly once, including when the same text is also supplied as another body field", () => {
  const distinctiveLine = "The frobnicator must never wobble the sprocket.";
  const tepBody = `## The asks\n${distinctiveLine}\n`;

  const prompt = buildWorkerPrompt(baseUnit, "1", {
    tepBody,
    // The same text supplied under a second body field — the duplication bug
    // this test guards against.
    sliceBody: tepBody,
  });

  const occurrences = prompt.split(distinctiveLine).length - 1;
  assert.equal(
    occurrences,
    1,
    `expected the distinctive line to appear exactly once, found ${occurrences}`,
  );
});
