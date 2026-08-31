/**
 * TRANSITION — refusalIfRefused is a new lookup: once noteAllowed has
 * recorded which shaping actions the host allows right now, asking about an
 * action the allowed list omits returns the refusal sentence for it, while
 * asking about an action the list includes returns nothing — the surface
 * can ask "why is this off" per control without re-deriving the phase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteAllowed, refusalIfRefused } from "./surfaceContract";

test("refusalIfRefused answers for an action the allowed list omits, and stays silent for one it includes", () => {
  noteAllowed(["rerun"], "signed");

  const refusal = refusalIfRefused("build");
  assert.equal(typeof refusal, "string");
  assert.ok(refusal && refusal.length > 0, "an omitted action must get a non-empty refusal sentence");

  const allowed = refusalIfRefused("rerun");
  assert.equal(allowed, undefined, "an action present in the allowed list must return nothing");
});
