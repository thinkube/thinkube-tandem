// WHY (INVARIANT): a worker given only a tepBody (no separate spec artifact
// in this run path) must be told, in a fixed phrase, that the intent is
// embedded in the brief itself — never pointed at a parent spec document
// that does not exist for it to go read.
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

test('buildWorkerPrompt called with only a tepBody renders an "embedded" phrase and no instruction to read the parent spec', () => {
  const tepText = "# TEP-only-4\n## The asks (verbatim)\n- Add a widget.";
  const prompt = buildWorkerPrompt(baseUnit(), "1", {
    tepBody: tepText,
  });
  assert.match(prompt, /embedded/i, "the prompt must say the intent is embedded in the brief");
  assert.doesNotMatch(
    prompt,
    /read the parent spec/i,
    "the prompt must not instruct the worker to go read a parent spec that does not exist in this run path",
  );
});
