/**
 * INVARIANT — refusalSentence must always give phase-specific wording where
 * the phase table defines a reason for that phase, rather than falling back
 * to the bare generic sentence used only when no phase-specific reason is
 * defined. The "understood" phase has its own reason ("nothing is signed or
 * running" per phase.ts today), so a refusal in that phase must read
 * differently from the bare fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refusalSentence } from "./surfaceContract";

test('refusalSentence for the "understood" phase differs from the bare fallback', () => {
  const understood = refusalSentence("build", "understood");
  const fallback = refusalSentence("build", undefined);

  assert.equal(typeof understood, "string");
  assert.equal(typeof fallback, "string");
  assert.notEqual(
    understood,
    fallback,
    "the understood-phase sentence must not be the same generic wording used when no phase-specific reason exists",
  );
});
