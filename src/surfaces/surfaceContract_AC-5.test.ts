/**
 * INVARIANT — the host's own refusal (refusedNow) and the surface's wording
 * (refusalSentence) must say exactly one sentence for a governed action
 * refused in a given phase. If they could differ, a press the surface let
 * through by mistake would be answered in different words than the button's
 * own off-state tooltip — two copies of the same fact drifting apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusalSentence } from "./surfaceContract";
import { refusedNow } from "./phase";

test("refusedNow for a forbidden action returns exactly refusalSentence's sentence for that phase", () => {
  // "build" is governed and is forbidden while a run is in flight ("running").
  const hostRefusal = refusedNow("build", "running");
  const surfaceSentence = refusalSentence("build", "running");

  assert.ok(hostRefusal, "the host must refuse a governed action forbidden in this phase");
  assert.equal(
    hostRefusal,
    surfaceSentence,
    "the host's refusal and the surface's refusal sentence must be word-for-word the same",
  );
});
