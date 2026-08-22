// WHY (INVARIANT): the intent/spec dedup only collapses when the two bodies
// are identical text — a genuinely different specBody and tepBody must
// always keep rendering both blocks, each exactly once, so a spec's own
// detail is never silently swallowed by the TEP summary or vice versa.
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

test("buildWorkerPrompt called with a specBody and a different tepBody still renders both blocks, each once", () => {
  const specText = "# SPEC-1\n## The asks (verbatim)\n- Add a widget.";
  const tepText = "# TEP-1\n## The asks (verbatim)\n- Add a widget, and make it spin.";
  const prompt = buildWorkerPrompt(baseUnit(), "1", {
    specBody: specText,
    tepBody: tepText,
  });
  assert.equal(prompt.split(specText).length - 1, 1, "the spec body must appear exactly once");
  assert.equal(prompt.split(tepText).length - 1, 1, "the TEP body must appear exactly once");
  assert.match(prompt, /THE INTENT/, "THE INTENT heading must still carry the TEP body");
  assert.match(prompt, /PARENT SPEC/, "PARENT SPEC heading must still carry the differing spec body");
});
