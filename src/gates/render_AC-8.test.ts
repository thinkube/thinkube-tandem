/**
 * The action that excuses documentation appears in AFFORDANCES with a
 * non-empty surface and gesture, so the no-capability-without-a-door check
 * covers it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AFFORDANCES } from "../surfaces/affordances";

test("excuse-docs carries a human door with a non-empty surface and gesture", () => {
  const entry = AFFORDANCES["excuse-docs"];
  assert.ok(entry, "excuse-docs must appear in AFFORDANCES");
  assert.equal(
    entry.kind,
    "human",
    "excusing documentation is a human judgement — it must declare a human door, never machine-only",
  );
  if (entry.kind === "human") {
    assert.ok(
      entry.affordance.surface.trim().length > 0,
      "the door must name the surface it lives on",
    );
    assert.ok(
      entry.affordance.gesture.trim().length > 0,
      "the door must name the gesture that reaches it",
    );
  }
});
