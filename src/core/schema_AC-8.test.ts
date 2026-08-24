/**
 * TRANSITION — foldSpaces keeps the FIRST author's copy of a delivery id
 * collision, whichever ran earlier. This proves that once two authors'
 * records each hold a delivery with the same id, the fold keeps the one
 * whose produced-at time is later, together with its run id — so the
 * folded space never presents an older run's report as the current one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "./records";
import { emptySpace } from "./schema";
import type { SnapshotRecord } from "./records";
import type { Delivery } from "./schema";

function spaceWithDelivery(delivery: Delivery): ReturnType<typeof emptySpace> {
  const s = emptySpace();
  s.deliveries.push(delivery);
  return s;
}

test("folding keeps the delivery whose produced-at time is later, with its run id", () => {
  const older = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [],
    runId: "TEP-1@older",
    producedAt: "2026-08-24T09:00:00.000Z",
  } as unknown as Delivery;
  const newer = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [],
    runId: "TEP-1@newer",
    producedAt: "2026-08-24T11:00:00.000Z",
  } as unknown as Delivery;

  const recA: SnapshotRecord = {
    at: "2026-08-24T09:05:00.000Z",
    author: "alice",
    kind: "snapshot",
    space: spaceWithDelivery(older),
    cut: [],
  };
  const recB: SnapshotRecord = {
    at: "2026-08-24T11:05:00.000Z",
    author: "bob",
    kind: "snapshot",
    space: spaceWithDelivery(newer),
    cut: [],
  };

  const folded = foldSpaces([recA, recB]);
  const kept = folded.deliveries.find((d) => d.id === "delivery-TEP-1");
  assert.ok(kept, "the delivery survives the fold");
  const stamped = kept as unknown as { runId?: string; producedAt?: string };
  assert.equal(stamped.producedAt, "2026-08-24T11:00:00.000Z", "the later produced-at wins");
  assert.equal(stamped.runId, "TEP-1@newer", "with the run id of the later delivery");

  // Order must not decide this — the same result folding B before A.
  const foldedReverse = foldSpaces([recB, recA]);
  const keptReverse = foldedReverse.deliveries.find((d) => d.id === "delivery-TEP-1") as unknown as {
    runId?: string;
    producedAt?: string;
  };
  assert.equal(keptReverse.producedAt, "2026-08-24T11:00:00.000Z", "fold order does not change the winner");
  assert.equal(keptReverse.runId, "TEP-1@newer");
});
