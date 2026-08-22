// WHY (INVARIANT): every capability the system accepts must map to a human
// door — a surface and a gesture — in the affordance registry the
// no-capability-without-a-door suite walks. This proves the
// documentation-exemption action is registered with a non-empty surface
// and gesture, so it is covered rather than silently machine-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AFFORDANCES } from "../out-test/surfaces/affordances.js";

test("the documentation-exemption action appears in AFFORDANCES with a non-empty surface and gesture", () => {
  const entry = AFFORDANCES["excuse-docs"];
  assert.ok(entry, "AFFORDANCES must carry an entry for the documentation-exemption action");
  assert.equal(entry.kind, "human", "excusing documentation is a human decision, not machine-only");
  assert.ok(
    entry.affordance?.surface?.trim(),
    "the entry must name a non-empty surface",
  );
  assert.ok(
    entry.affordance?.gesture?.trim(),
    "the entry must name a non-empty gesture",
  );
});
