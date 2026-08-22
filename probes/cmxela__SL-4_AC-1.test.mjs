// WHY (TRANSITION): buildWorkerPrompt used to render the spec body and the
// TEP body as two separate blocks even when they carry the exact same text —
// this proves that change is done: called with the same text as both
// specBody and tepBody, the returned prompt contains that text exactly once.
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

test("buildWorkerPrompt called with the same text as both specBody and tepBody renders that text exactly once", () => {
  const sharedText =
    "# TEP-shared-1\n## The asks (verbatim)\n- Add a widget.\n## The changes\n- the widget resizes\n  - lands at src/widget.ts\n  ## Acceptance Criteria\n  - [ ] it resizes";
  const prompt = buildWorkerPrompt(baseUnit(), "1", {
    specBody: sharedText,
    tepBody: sharedText,
  });
  const occurrences = prompt.split(sharedText).length - 1;
  assert.equal(occurrences, 1, "the shared text must ride the prompt exactly once, not once per block");
});
