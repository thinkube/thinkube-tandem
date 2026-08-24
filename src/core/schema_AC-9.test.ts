/**
 * TRANSITION — folding two deliveries with the same id today keeps whichever
 * arrived first, stamped or not, and an accept fact from either side can be
 * lost if it lands on the copy that is not kept. This proves folding always
 * prefers the stamped delivery over an unstamped one with the same id — in
 * either arrival order — while never dropping the acceptance fact when it
 * sits on the record that is not otherwise kept.
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

test("folding keeps a stamped delivery over an unstamped one with the same id, and keeps the acceptance fact either way", () => {
  const unstamped: Delivery = {
    id: "delivery-TEP-2",
    cutId: "cut-2",
    branch: "tandem/TEP-2",
    proofs: [],
    acceptedAt: "2026-08-24T08:00:00.000Z",
  };
  const stamped = {
    id: "delivery-TEP-2",
    cutId: "cut-2",
    branch: "tandem/TEP-2",
    proofs: [],
    runId: "TEP-2@stamped",
    producedAt: "2026-08-24T09:00:00.000Z",
  } as unknown as Delivery;

  const recUnstampedFirst: SnapshotRecord = {
    at: "2026-08-24T08:05:00.000Z",
    author: "alice",
    kind: "snapshot",
    space: spaceWithDelivery(unstamped),
    cut: [],
  };
  const recStampedSecond: SnapshotRecord = {
    at: "2026-08-24T09:05:00.000Z",
    author: "bob",
    kind: "snapshot",
    space: spaceWithDelivery(stamped),
    cut: [],
  };

  const folded = foldSpaces([recUnstampedFirst, recStampedSecond]);
  const kept = folded.deliveries.find((d) => d.id === "delivery-TEP-2");
  assert.ok(kept, "the delivery survives the fold");
  const stampedKept = kept as unknown as { runId?: string };
  assert.equal(stampedKept.runId, "TEP-2@stamped", "the stamped delivery is kept, whichever author's record wins");
  assert.equal(kept!.acceptedAt, "2026-08-24T08:00:00.000Z", "the acceptance fact from the unstamped copy is not lost");

  // Same in the other arrival order: acceptedAt now sits on the STAMPED
  // side and must still survive.
  const stampedWithAccept = { ...stamped, acceptedAt: "2026-08-24T08:00:00.000Z" } as unknown as Delivery;
  const unstampedNoAccept: Delivery = {
    id: "delivery-TEP-2",
    cutId: "cut-2",
    branch: "tandem/TEP-2",
    proofs: [],
  };
  const recStampedFirst: SnapshotRecord = {
    at: "2026-08-24T09:05:00.000Z",
    author: "bob",
    kind: "snapshot",
    space: spaceWithDelivery(stampedWithAccept),
    cut: [],
  };
  const recUnstampedSecond: SnapshotRecord = {
    at: "2026-08-24T08:05:00.000Z",
    author: "alice",
    kind: "snapshot",
    space: spaceWithDelivery(unstampedNoAccept),
    cut: [],
  };
  const foldedReverse = foldSpaces([recStampedFirst, recUnstampedSecond]);
  const keptReverse = foldedReverse.deliveries.find((d) => d.id === "delivery-TEP-2");
  assert.ok(keptReverse, "the delivery survives the fold in reverse order too");
  assert.equal(
    (keptReverse as unknown as { runId?: string }).runId,
    "TEP-2@stamped",
    "the stamped delivery is still kept",
  );
  assert.equal(keptReverse!.acceptedAt, "2026-08-24T08:00:00.000Z", "and the acceptance fact still rides along");
});
