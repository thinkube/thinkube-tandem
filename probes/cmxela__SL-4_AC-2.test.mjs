// WHY (TRANSITION): when the spec body and the TEP body are the same text,
// only THE INTENT block may be emitted — this proves the PARENT SPEC block
// (and its heading) is dropped in that case, leaving THE INTENT heading as
// the sole carrier of that text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../out-test/engine/core/preflight.js";

function baseUnit() {
  return {
    id: "SL-1#eu-1",
    slice: "SL-1",
    footprint: ["src/widget.ts"],
    requires: [],
    shape: "serial",
    role: "code",
    note: "Add a widget.",
  };
}

test("buildWorkerPrompt called with the same text as both specBody and tepBody renders THE INTENT heading and no PARENT SPEC heading", () => {
  const sharedText = "# TEP-shared-2\n## The asks (verbatim)\n- Add a widget.";
  const prompt = buildWorkerPrompt(baseUnit(), "1", {
    specBody: sharedText,
    tepBody: sharedText,
  });
  assert.match(prompt, /THE INTENT/, "THE INTENT heading must be present");
  assert.doesNotMatch(prompt, /PARENT SPEC/, "PARENT SPEC heading must not be rendered when the two bodies are identical");
});
