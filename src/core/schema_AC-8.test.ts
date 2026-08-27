/**
 * INVARIANT — tepContentHash changes when a member's sentence, landing,
 * criterion text or needs change, for a cut with no docs/ touchpoint: the
 * hash still binds the grounded members after the documentation refusal
 * lands, so drift in the promises is never silently dropped from it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tepContentHash } from "../gates/approval";
import { emptySpace } from "./schema";

const baseSpace = (overrides: Partial<{ sentence: string; path: string; criterionText: string; needs: string[] }> = {}) => ({
  ...emptySpace(),
  nodes: [
    {
      id: "n0",
      sentence: "a prerequisite",
      serves: [],
      needs: [],
      acceptance: [{ id: "c0", text: "it exists" }],
      grounding: { touchpoints: [{ path: "src/pre.ts", planned: true }], stamp: [] },
    },
    {
      id: "n1",
      sentence: overrides.sentence ?? "greet the user",
      serves: [],
      needs: overrides.needs ?? [],
      acceptance: [{ id: "c1", text: overrides.criterionText ?? "greet() returns hello" }],
      grounding: { touchpoints: [{ path: overrides.path ?? "src/greet.ts", planned: true }], stamp: [] },
    },
  ],
});

const cut = { id: "cut-1", changeIds: ["n1"], docsExemption: { reason: "internal", at: "2026-08-27T00:00:00Z" } };

test("tepContentHash changes when the member's sentence changes", () => {
  const base = tepContentHash(baseSpace(), cut);
  const changed = tepContentHash(baseSpace({ sentence: "greet the visitor" }), cut);
  assert.notEqual(base, changed);
});

test("tepContentHash changes when the member's landing (grounded path) changes", () => {
  const base = tepContentHash(baseSpace(), cut);
  const changed = tepContentHash(baseSpace({ path: "src/other.ts" }), cut);
  assert.notEqual(base, changed);
});

test("tepContentHash changes when a criterion's text changes", () => {
  const base = tepContentHash(baseSpace(), cut);
  const changed = tepContentHash(baseSpace({ criterionText: "greet() returns hi" }), cut);
  assert.notEqual(base, changed);
});

test("tepContentHash changes when what a member needs changes", () => {
  const base = tepContentHash(baseSpace(), cut);
  const changed = tepContentHash(baseSpace({ needs: ["n0"] }), cut);
  assert.notEqual(base, changed);
});
