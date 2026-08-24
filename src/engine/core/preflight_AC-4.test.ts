/**
 * Once the brief carries one embedded intent artifact, the worker must be
 * told plainly that its intent is already in front of it — never sent to
 * hunt the filesystem for a spec that is not in its worktree.
 *
 * STANDING INVARIANT — whenever tepBody is supplied, buildWorkerPrompt's
 * output states the worker's intent is embedded in the brief, and contains
 * no instruction directing the worker to read a spec from the filesystem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "./preflight";
import { SchedUnit } from "./dag";

const codeUnit: SchedUnit = {
  id: "SL-1#eu-1",
  slice: "SL-1",
  footprint: ["src/a.ts"],
  requires: [],
  shape: "serial",
  role: "code",
  note: "do the thing",
};

test("buildWorkerPrompt's output, when tepBody is supplied, says the intent is embedded and never sends the worker to read a spec off disk", () => {
  const prompt = buildWorkerPrompt(codeUnit, "1", {
    tepBody: "## The asks\nDo the thing.\n",
  });

  assert.match(
    prompt,
    /embedded/i,
    "the brief must explicitly say the worker's intent is embedded in it",
  );
  assert.doesNotMatch(
    prompt,
    /read the (parent )?spec[^.]*for context/i,
    "the brief must not instruct the worker to go read a spec for context",
  );
  assert.doesNotMatch(
    prompt,
    /search the filesystem for specs/i,
    "the brief must not send the worker hunting the filesystem for a spec",
  );
});
