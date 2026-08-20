// WHY (TRANSITION): when specBody and tepBody are the same text, the prompt must be headed
// by "THE INTENT — the north star" only — the "PARENT SPEC" heading must not also appear,
// since that would announce a second, separate artifact that does not exist in this run path.
// Proves the heading collapse landed; its job is done once the change ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../out-test/engine/core/preflight.js";

test("buildWorkerPrompt: identical specBody/tepBody renders THE INTENT heading, never PARENT SPEC", () => {
  const unit = {
    id: "SP-4_SL-2#eu-0",
    slice: "SP-4_SL-2",
    footprint: ["src/b.ts"],
    requires: [],
    shape: "serial",
    role: "code",
  };
  const sharedText = "## The asks (verbatim)\n- ship the docs exemption gesture.";
  const p = buildWorkerPrompt(unit, "4", {
    specBody: sharedText,
    tepBody: sharedText,
  });
  assert.match(p, /THE INTENT — the north star/);
  assert.doesNotMatch(p, /PARENT SPEC/);
});
