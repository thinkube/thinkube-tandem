/**
 * A code worker builds to the intent, not to the grading rubric: when the
 * single embedded intent artifact (tepBody) carries a `satisfies:` key, a
 * code unit's brief must render that intent copy with the `satisfies:`
 * lines stripped, the same withholding buildWorkerPrompt already applied to
 * the old specBody/sliceBody blocks.
 *
 * STANDING INVARIANT — buildWorkerPrompt strips `satisfies:` lines out of
 * the intent copy it renders for a code unit.
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

test("buildWorkerPrompt called for a code unit renders the intent copy with satisfies: lines removed", () => {
  const tepBody =
    "## The asks\nDo the thing.\nsatisfies:\n  - 1\n  - 2\nMore intent text.\n";

  const prompt = buildWorkerPrompt(codeUnit, "1", { tepBody });

  assert.doesNotMatch(
    prompt,
    /satisfies\s*:/i,
    "a satisfies: key must not appear anywhere in a code unit's brief",
  );
  assert.match(
    prompt,
    /Do the thing\./,
    "the surrounding intent prose must still be present",
  );
  assert.match(
    prompt,
    /More intent text\./,
    "the surrounding intent prose must still be present",
  );
});
