/**
 * TRANSITION: the brief used to hold the TEP text and the spec text apart
 * under two headings, with a "PARENT SPEC" block telling the worker to look
 * elsewhere for the spec. That split is gone: buildWorkerPrompt no longer
 * accepts a separate spec-body slot, and with a TEP body but no slice body,
 * the brief's opening orientation line must say the worker's intent is
 * embedded in this document (referencing "below") and must not point at a
 * separate spec anywhere — no "PARENT SPEC" heading, no instruction to look
 * elsewhere for the spec. This proves the removal shipped; once the
 * separate slot is gone for good, this check has nothing further to prove.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "./preflight";
import { SchedUnit } from "./dag";

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

test("with a TEP body and no slice body, the opening line says the intent is embedded below, and no separate spec is referenced", () => {
  const tepBody =
    "# TEP-cmxela-30\nA cut carries its documentation decision, one rule in one place.";
  const brief = buildWorkerPrompt(codeUnit(), "TEP-cmxela-30", {
    tepBody,
  });
  const openingLine = brief.split(/\r?\n/, 4).join("\n");
  assert.match(
    openingLine,
    /below/i,
    "the opening orientation line should reference the intent being embedded below",
  );
  assert.doesNotMatch(
    brief,
    /PARENT SPEC/,
    "no 'PARENT SPEC' heading should remain anywhere in the brief",
  );
  assert.doesNotMatch(
    brief,
    /look elsewhere for the spec/i,
    "the brief should not instruct the worker to look elsewhere for the spec",
  );
});
