/**
 * TRANSITION — before this rule existed, applying several staged
 * implications one at a time cost one press each. implicationRows now
 * offers a single { action: "apply-all-impacts" } act only once two or
 * more implications are staged; with one staged, or none, no such act is
 * offered — one press is only cheaper than several when there are several.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { implicationRows } from "./implications";
import type { SpacePush } from "./surfaceContract";

function pushWith(impacts: SpacePush["impacts"]): SpacePush {
  return {
    kind: "space",
    running: false,
    phase: "understood",
    allowed: [],
    signedTeps: 0,
    questions: [],
    decisions: [],
    orphans: [],
    sentences: [],
    cost: { subjects: 0, rounds: 0 },
    outOfDate: { promises: 0, subjects: 0, rounds: 0 },
    ready: { subjects: 0, promises: 0, asks: 0, thinking: false },
    draft: "",
    impacts,
    subjects: [],
    cutCount: 0,
    deliveries: [],
    documentation: { state: "missing", landings: [] },
  } as SpacePush;
}

test("implicationRows offers no apply-all act when a single implication is staged", () => {
  const push = pushWith([{ id: "imp-1", decision: "decision one", askText: "ask one", affected: 1 }]);

  const out = implicationRows(push);

  assert.equal(out.applyAll, undefined, "one implication staged offers no apply-all act");
});

test("implicationRows offers no apply-all act when no implications are staged", () => {
  const push = pushWith([]);

  const out = implicationRows(push);

  assert.equal(out.applyAll, undefined, "no implications staged offers no apply-all act");
});

test("implicationRows offers a single apply-all act once two or more implications are staged", () => {
  const push = pushWith([
    { id: "imp-1", decision: "decision one", askText: "ask one", affected: 1 },
    { id: "imp-2", decision: "decision two", askText: "ask two", affected: 2 },
  ]);

  const out = implicationRows(push);

  assert.deepEqual(
    out.applyAll,
    { action: "apply-all-impacts" },
    "two staged implications offer exactly one apply-all act",
  );
});

test("implicationRows keeps offering a single apply-all act with three or more staged", () => {
  const push = pushWith([
    { id: "imp-1", decision: "decision one", askText: "ask one", affected: 1 },
    { id: "imp-2", decision: "decision two", askText: "ask two", affected: 2 },
    { id: "imp-3", decision: "decision three", askText: "ask three", affected: 3 },
  ]);

  const out = implicationRows(push);

  assert.deepEqual(
    out.applyAll,
    { action: "apply-all-impacts" },
    "more than two staged implications still offer exactly one apply-all act, not one per extra row",
  );
});
