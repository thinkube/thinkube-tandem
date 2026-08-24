/**
 * The held-out test author is trusted with the full grading picture: when
 * the single embedded intent artifact (tepBody) carries a `satisfies:` key,
 * a test unit's brief must render that intent copy verbatim, satisfies:
 * lines included, unlike the stripped copy a code unit receives.
 *
 * STANDING INVARIANT — buildWorkerPrompt renders the intent copy verbatim
 * (satisfies: lines included) for a test unit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt } from "./preflight";
import { SchedUnit } from "./dag";

const testUnit: SchedUnit = {
  id: "SL-1#eu-2",
  slice: "SL-1",
  footprint: ["src/a.test.ts"],
  requires: [],
  shape: "serial",
  role: "test",
  note: "assert the thing",
};

test("buildWorkerPrompt called for a test unit renders the intent copy verbatim, satisfies: lines included", () => {
  const tepBody =
    "## The asks\nDo the thing.\nsatisfies:\n  - 1\n  - 2\nMore intent text.\n";

  const prompt = buildWorkerPrompt(testUnit, "1", { tepBody });

  assert.match(
    prompt,
    /satisfies\s*:/i,
    "a test unit's brief must keep the satisfies: key verbatim",
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
