/**
 * The affordance registry: every capability the system accepts must map to
 * a human door — a surface and a gesture — so the no-capability-without-a-
 * door suite can cover it rather than leaving it silently machine-only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AFFORDANCES } from "./affordances";

test("the documentation-exemption action appears in AFFORDANCES with a non-empty surface and gesture", () => {
  const entry = AFFORDANCES["excuse-docs"];
  assert.ok(entry, "AFFORDANCES must carry an entry for the documentation-exemption action");
  assert.equal(entry.kind, "human", "excusing documentation is a human decision, not machine-only");
  assert.ok(
    entry.kind === "human" && entry.affordance.surface.trim(),
    "the entry must name a non-empty surface",
  );
  assert.ok(
    entry.kind === "human" && entry.affordance.gesture.trim(),
    "the entry must name a non-empty gesture",
  );
});
