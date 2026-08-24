/**
 * A worker's brief must carry the TEP once. Before this change dispatch.ts
 * handed the same rendered TEP body to buildWorkerPrompt under two names
 * (`specBody` and `tepBody`), so the prompt rendered the parent-spec block
 * and the intent block back to back with identical content. This pins the
 * fix at the prompt builder's own seam: fed one distinctive line, that line
 * must appear in the finished prompt exactly once — no matter how many
 * context keys it is threaded under.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../engine/core/preflight";
import type { SchedUnit } from "../engine/core/dag";

const unit = (): SchedUnit => ({
  id: "SL-1#eu-1",
  slice: "SL-1",
  footprint: ["src/x.ts"],
  requires: [],
  shape: "serial",
});

// TRANSITION — pins that the two-name duplication (specBody === tepBody) is gone:
// a distinctive line handed in as the TEP body must occur exactly once in the prompt.
test("buildWorkerPrompt renders a distinctive tepBody line exactly once", () => {
  const distinctive = "THE-DISTINCTIVE-TEP-LINE-9f2c1a";
  const tepBody = `# TEP-1\n${distinctive}\n`;
  const prompt = buildWorkerPrompt(unit(), "1", { tepBody });
  const occurrences = prompt.split(distinctive).length - 1;
  assert.equal(
    occurrences,
    1,
    `expected the distinctive TEP line to occur exactly once in the prompt, found ${occurrences}`,
  );
});
