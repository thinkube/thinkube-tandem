// WHY (TRANSITION): the documentation-exemption action is a new human
// capability and must have a door — a surface and a gesture — registered in
// AFFORDANCES, or the no-capability-without-a-door check cannot cover it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AFFORDANCES } from "../out-test/surfaces/affordances.js";

test("the action that excuses documentation appears in AFFORDANCES with a non-empty surface and gesture", () => {
  const entry = AFFORDANCES["excuse-docs"];
  assert.ok(entry, "AFFORDANCES must register the documentation-exemption action");
  assert.equal(entry.kind, "human", "excusing documentation is a human decision, not machine-only");
  assert.ok(
    typeof entry.affordance.surface === "string" && entry.affordance.surface.trim().length > 0,
    "the door's surface must be named and non-empty",
  );
  assert.ok(
    typeof entry.affordance.gesture === "string" && entry.affordance.gesture.trim().length > 0,
    "the door's gesture must be named and non-empty",
  );
});
