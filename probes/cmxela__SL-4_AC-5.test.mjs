// WHY (INVARIANT): `satisfies` ordinals are grader bookkeeping withheld from
// a code-role worker — the TEP body now rides the same code-role prompt as
// the spec body did, so it must be stripped exactly the same way: a
// `satisfies` block present in tepBody must not survive into a code unit's
// prompt, same as it never survived from specBody.
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

test("for a code-role unit, a `satisfies` ordinal present in the tepBody is absent from the returned prompt, exactly as it is for the specBody", () => {
  const specWithSatisfies =
    "# SPEC-5\n## The asks (verbatim)\n- Add a widget.\nsatisfies:\n  - 1\n  - 2\n";
  const tepWithSatisfies =
    "# TEP-5\n## The asks (verbatim)\n- Add a widget.\nsatisfies:\n  - 3\n  - 4\n";
  const prompt = buildWorkerPrompt(baseUnit(), "1", {
    specBody: specWithSatisfies,
    tepBody: tepWithSatisfies,
  });
  assert.doesNotMatch(prompt, /satisfies\s*:/i, "no `satisfies:` key may reach a code unit's prompt from either body");
});
