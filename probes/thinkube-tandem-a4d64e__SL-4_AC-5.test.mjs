// WHY (INVARIANT): a code worker must never see the grader's `satisfies` ordinal bookkeeping —
// that stripping already applies to specBody and must keep applying identically when the same
// text rides as tepBody (THE INTENT block), since it renders in the same prompt a code worker
// reads. Must hold forever, for either field carrying the structured key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../out-test/engine/core/preflight.js";

test("buildWorkerPrompt: a `satisfies` ordinal in tepBody is stripped from a code unit's prompt, like specBody", () => {
  const unit = {
    id: "SP-4_SL-5#eu-0",
    slice: "SP-4_SL-5",
    footprint: ["src/e.ts"],
    requires: [],
    shape: "serial",
    role: "code",
  };
  const bodyWithSatisfies = [
    "---",
    "satisfies: [3, 5]",
    "---",
    "",
    "## Goal",
    "",
    "A person can excuse documentation with a written reason.",
  ].join("\n");

  const viaTep = buildWorkerPrompt(unit, "4", { tepBody: bodyWithSatisfies });
  assert.doesNotMatch(viaTep, /satisfies\s*:/i);
  assert.doesNotMatch(viaTep, /\[3, 5\]/);
  assert.match(viaTep, /A person can excuse documentation with a written reason\./);

  const viaSpec = buildWorkerPrompt(unit, "4", { specBody: bodyWithSatisfies });
  assert.doesNotMatch(viaSpec, /satisfies\s*:/i);
  assert.doesNotMatch(viaSpec, /\[3, 5\]/);
});
