/**
 * INVARIANT — every action the phase table governs must have a
 * person-facing control name, checked by importing the real gatedActions()
 * set rather than by matching action strings as text. A governed action
 * with no name would let a refusal fall back to a bare "not now" with
 * nothing for the person to recognise on screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatedActions } from "./phase";
import { CONTROL_NAMES } from "./surfaceContract";

test("every action gatedActions() returns has a control name in CONTROL_NAMES", () => {
  const gated = gatedActions();
  assert.ok(gated.length > 0, "the phase table must govern at least one action");

  const missing = gated.filter((action) => !CONTROL_NAMES[action]);
  assert.deepEqual(
    missing,
    [],
    `every governed action needs a control name; missing for: ${missing.join(", ")}`,
  );
});
