/**
 * TRANSITION — before implicationRows existed, there was no way to apply or
 * set aside one staged implication. This pins that each row offers apply as
 * { action: "accept-impact", impactId } and set aside as
 * { action: "dismiss-impact", impactId }, both naming that same row's id —
 * so a press on one row can never act on another implication.
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

test("a row's apply act names its own id under accept-impact", () => {
  const push = pushWith([
    { id: "imp-7", decision: "keep the shorter name", askText: "what should it be called?", affected: 2 },
  ]);

  const [row] = implicationRows(push);

  assert.deepEqual(
    row.apply,
    { action: "accept-impact", impactId: "imp-7" },
    "apply carries accept-impact for this row's own id",
  );
});

test("a row's set-aside act names its own id under dismiss-impact", () => {
  const push = pushWith([
    { id: "imp-7", decision: "keep the shorter name", askText: "what should it be called?", affected: 2 },
  ]);

  const [row] = implicationRows(push);

  assert.deepEqual(
    row.setAside,
    { action: "dismiss-impact", impactId: "imp-7" },
    "setAside carries dismiss-impact for this row's own id",
  );
});

test("each row's acts name that row's own id, not another row's", () => {
  const push = pushWith([
    { id: "imp-a", decision: "decision a", askText: "ask a", affected: 1 },
    { id: "imp-b", decision: "decision b", askText: "ask b", affected: 2 },
  ]);

  const [rowA, rowB] = implicationRows(push);

  assert.equal(rowA.apply.impactId, "imp-a", "row a's apply names row a");
  assert.equal(rowA.setAside.impactId, "imp-a", "row a's set-aside names row a");
  assert.equal(rowB.apply.impactId, "imp-b", "row b's apply names row b");
  assert.equal(rowB.setAside.impactId, "imp-b", "row b's set-aside names row b");
});
