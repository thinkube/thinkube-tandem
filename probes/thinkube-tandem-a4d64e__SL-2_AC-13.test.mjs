// AC-13 (INVARIANT): declaring documentation not needed is a registered
// affordance — AFFORDANCES names the cut review as its surface and the
// reason-asking gesture, gestureFor returns a real line for it, and the
// reachability sweep over SESSION_ACTIONS passes with the new action
// included. A capability without a registered door is a capability the
// suite would otherwise let through unreachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AFFORDANCES, SESSION_ACTIONS, gestureFor } = require("../out/surfaces/affordances.js");

function findWaiverActionKey() {
  return Object.keys(AFFORDANCES).find((k) => {
    const entry = AFFORDANCES[k];
    if (entry.kind !== "human") return false;
    const hay = `${k} ${entry.affordance.surface} ${entry.affordance.gesture}`.toLowerCase();
    return (
      (hay.includes("waive") || hay.includes("not needed") || hay.includes("no docs") || hay.includes("docs")) &&
      hay.includes("reason")
    );
  });
}

test("AFFORDANCES holds an entry for the documentation-waiver action naming the cut review and its reason gesture", () => {
  const key = findWaiverActionKey();
  assert.ok(key, "an affordance entry exists for declaring documentation not needed");
  const entry = AFFORDANCES[key];
  assert.equal(entry.kind, "human", "the waiver is a human act, not machine-only");
  assert.match(
    entry.affordance.surface,
    /cut review/i,
    "the waiver's surface is named as the cut review",
  );
  assert.match(entry.affordance.gesture, /reason/i, "the gesture asks for the reason");
});

test("gestureFor the waiver action returns a non-empty line, and it is reachable via SESSION_ACTIONS", () => {
  const key = findWaiverActionKey();
  assert.ok(key, "the waiver action key exists");
  const line = gestureFor(key);
  assert.ok(line && line.trim().length > 0, "gestureFor returns a non-empty line for the waiver action");
  assert.ok(
    SESSION_ACTIONS.includes(key),
    "the waiver action is registered in SESSION_ACTIONS so the reachability sweep covers it",
  );
});
