/**
 * TRANSITION — implicationRows is a new seam: before it existed, a staged
 * implication had no row a surface could draw. This pins that each row
 * carries the decision's own text, the ask it would re-derive, and how
 * many promises that re-derivation touches — one row per implication the
 * push staged, taken from SpacePush.impacts.
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

test("implicationRows returns one row per staged implication, carrying its decision, ask and affected count", () => {
  const push = pushWith([
    { id: "imp-1", decision: "use the new label format", askText: "how should labels read?", affected: 3 },
  ]);

  const rows = implicationRows(push);

  assert.equal(rows.length, 1, "one implication staged produces one row");
  assert.equal(rows[0].decision, "use the new label format", "the row carries the decision's own text");
  assert.equal(rows[0].askText, "how should labels read?", "the row carries the ask it would re-derive");
  assert.equal(rows[0].affected, 3, "the row carries how many promises the re-derivation touches");
});

test("implicationRows returns one row for each of several staged implications", () => {
  const push = pushWith([
    { id: "imp-1", decision: "decision one", askText: "ask one", affected: 1 },
    { id: "imp-2", decision: "decision two", askText: "ask two", affected: 5 },
  ]);

  const rows = implicationRows(push);

  assert.equal(rows.length, 2, "two staged implications produce two rows");
  assert.deepEqual(
    rows.map((r) => r.decision),
    ["decision one", "decision two"],
    "each row carries its own implication's decision text",
  );
});
