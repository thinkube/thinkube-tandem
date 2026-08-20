// WHY (TRANSITION): buildWorkerPrompt used to render the spec body AND the TEP body as two
// separate blocks — when a caller passes the SAME text for both (this run path has no
// separate spec artifact), the text must now render EXACTLY ONCE in the prompt, not twice.
// This proves the de-duplication landed; it is done once the change ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../out-test/engine/core/preflight.js";

test("buildWorkerPrompt: identical specBody/tepBody text renders exactly once in the prompt", () => {
  const unit = {
    id: "SP-4_SL-1#eu-0",
    slice: "SP-4_SL-1",
    footprint: ["src/a.ts"],
    requires: [],
    shape: "serial",
    role: "code",
    note: "wire a",
  };
  const sharedText =
    "## The asks (verbatim)\n- a person can archive a card with one keystroke.\n## The changes\n- wire the archive reducer.";
  const p = buildWorkerPrompt(unit, "4", {
    specBody: sharedText,
    tepBody: sharedText,
  });
  const escaped = sharedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occurrences = (p.match(new RegExp(escaped, "g")) ?? []).length;
  assert.equal(
    occurrences,
    1,
    "the shared text must appear exactly once, not once per block",
  );
});
