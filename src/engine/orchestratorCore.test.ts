/**
 * The RUN PREFLIGHT provisions check, and the worker-prompt builder's
 * context tranche: what a worker prompt carries before any dispatch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "./core/preflight";
import type { SchedUnit } from "./core/dag";

function unit(overrides: Partial<SchedUnit> = {}): SchedUnit {
  return {
    id: "SL-1#eu-0",
    slice: "SL-1",
    footprint: ["src/x.ts"],
    requires: [],
    shape: "serial",
    role: "code",
    ...overrides,
  };
}

// INVARIANT: when the spec body and the TEP body are the same rendered text
// (this run path's normal case — there is no separate spec artifact), the
// prompt embeds that text exactly once, under THE INTENT, never doubled
// under a second PARENT SPEC heading.
test("buildWorkerPrompt: identical specBody and tepBody render once, under THE INTENT only", () => {
  const shared = "The shared TEP text every worker reads as the north star.";
  const prompt = buildWorkerPrompt(unit(), "1", {
    specBody: shared,
    tepBody: shared,
  });
  const occurrences = prompt.split(shared).length - 1;
  assert.equal(occurrences, 1, "the shared text must appear exactly once");
  assert.match(prompt, /THE INTENT/);
  assert.doesNotMatch(prompt, /PARENT SPEC/);
});

// INVARIANT: a genuine spec layered over a different TEP still renders
// both blocks, each exactly once — dedup applies only when the two texts
// are the same, never as a general "collapse the spec" rule.
test("buildWorkerPrompt: differing specBody and tepBody render both blocks, each once", () => {
  const spec = "The spec-only text.";
  const tep = "The TEP-only text, worded differently.";
  const prompt = buildWorkerPrompt(unit(), "1", {
    specBody: spec,
    tepBody: tep,
  });
  assert.equal(prompt.split(spec).length - 1, 1);
  assert.equal(prompt.split(tep).length - 1, 1);
  assert.match(prompt, /PARENT SPEC/);
  assert.match(prompt, /THE INTENT/);
});

// INVARIANT: with only a tepBody supplied (no specBody, no sliceBody — the
// no-separate-spec-artifact run path), the prompt states the intent is
// embedded in the brief and never sends the worker hunting for a parent
// spec document that this run path does not carry.
test("buildWorkerPrompt: tepBody alone states the intent is embedded, never 'read the parent spec'", () => {
  const tep = "Only the TEP body rides this brief.";
  const prompt = buildWorkerPrompt(unit(), "1", { tepBody: tep });
  assert.match(prompt, /embedded/i);
  assert.doesNotMatch(prompt, /read the parent spec/i);
});

// TRANSITION: a `satisfies` ordinal is stripped from tepBody for a code-role
// unit exactly as it already is for specBody — tepBody used to be embedded
// raw, so a satisfies block would have leaked into a coder's prompt.
test("buildWorkerPrompt: a code unit strips a `satisfies` ordinal out of tepBody, same as specBody", () => {
  const satisfiesLine = "satisfies: 3";
  const spec = `Spec body.\n${satisfiesLine}\nmore spec text.`;
  const tep = `TEP body, different from spec.\n${satisfiesLine}\nmore tep text.`;
  const prompt = buildWorkerPrompt(unit({ role: "code" }), "1", {
    specBody: spec,
    tepBody: tep,
  });
  assert.doesNotMatch(prompt, /satisfies:\s*3/);
});
