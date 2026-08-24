/**
 * Before this change, a worker whose prompt carried no sliceBody (nothing
 * for the old `hasCtx = specBlock || sliceBlock` check to see) fell back to
 * "(Read the parent spec/slice for context if available — note the specs
 * dir may not be in this worktree.)" even though the TEP body WAS embedded
 * in the same prompt — a worker sent to hunt a specs directory it will
 * never find, while its actual context sat a few lines below. This pins
 * that once a TEP body is present the opening paragraph says plainly that
 * context is embedded, and never tells the worker to go look for a specs
 * directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "../engine/core/preflight";
import type { SchedUnit } from "../engine/core/dag";

const unit = (): SchedUnit => ({
  id: "SL-1#eu-1",
  slice: "SL-1",
  footprint: ["src/x.ts"],
  requires: [],
  shape: "serial",
});

// TRANSITION — pins that a tepBody with no sliceBody now yields an explicit
// "context is embedded" statement instead of the old "hunt the specs dir" fallback.
test("buildWorkerPrompt, given a tepBody and no sliceBody, states context is embedded and never points at a specs directory", () => {
  const tepBody = "# TEP-1\nsome intent text\n";
  const prompt = buildWorkerPrompt(unit(), "1", { tepBody });

  const firstParagraph = prompt.split(/\n\s*\n/)[0];
  assert.match(
    firstParagraph,
    /embedded/i,
    `expected the first paragraph to explicitly state that context is embedded, got: ${JSON.stringify(firstParagraph)}`,
  );
  assert.doesNotMatch(
    prompt,
    /specs? dir/i,
    "the prompt must not reference a specs directory or instruct the worker to look one up",
  );
  assert.doesNotMatch(
    prompt,
    /look\s+(it\s+)?up/i,
    "the prompt must not instruct the worker to look up a specs directory",
  );
});
