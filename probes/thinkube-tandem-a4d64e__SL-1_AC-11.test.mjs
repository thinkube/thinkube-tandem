// WHY (INVARIANT): two authors waiving the SAME cut with DIFFERENT reasons
// is a contradictory decision — the fold must not silently pick one by
// merge order, exactly like any other contradictory decision it surfaces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "../out/core/records.js";
import { emptySpace } from "../out/core/schema.js";

test("folding two waivers of the same cut with different reasons does not pick one by merge order", () => {
  const cutId = "cut-shared";
  const first = {
    author: "alice",
    space: {
      ...emptySpace(),
      cuts: [{ id: cutId, changeIds: ["node-1"], docs: { waived: true, reason: "reason A" } }],
    },
  };
  const second = {
    author: "bob",
    space: {
      ...emptySpace(),
      cuts: [{ id: cutId, changeIds: ["node-1"], docs: { waived: true, reason: "reason B" } }],
    },
  };
  const foldedAB = foldSpaces([first, second]);
  const foldedBA = foldSpaces([second, first]);
  const cutAB = foldedAB.cuts.find((c) => c.id === cutId);
  const cutBA = foldedBA.cuts.find((c) => c.id === cutId);
  assert.ok(cutAB, "the shared cut survives the A-then-B fold");
  assert.ok(cutBA, "the shared cut survives the B-then-A fold");
  // Merge order must not decide the winner: either the fold surfaces the
  // collision as a question (space.questions gains an entry naming the
  // cut), or the cut itself is qualified so it no longer holds a single
  // silently-picked reason — either way, A-then-B and B-then-A must AGREE.
  const collisionSurfaced =
    (foldedAB.questions ?? []).some((q) => JSON.stringify(q).includes(cutId)) ||
    cutAB.docs?.reason !== "reason A" && cutAB.docs?.reason !== "reason B";
  assert.ok(
    collisionSurfaced,
    "a same-cut waiver collision with differing reasons is qualified or surfaced, not silently resolved",
  );
  assert.deepEqual(
    cutAB,
    cutBA,
    "the fold's outcome for a contradictory waiver does not depend on merge order",
  );
});
