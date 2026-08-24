/**
 * TRANSITION — the fold carries an ACCEPTANCE fact forward onto whichever
 * copy of a delivery wins, but a REJECTION recorded by the person was lost
 * the moment a later run reported the same delivery id without one. Saying
 * "no" is a decision the machine must be able to keep. This proves a
 * rejected-at moment sitting on the record that LOSES the fold still rides
 * onto the delivery the fold returns.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "./records";
import { emptySpace } from "./schema";
import type { SnapshotRecord } from "./records";
import type { Delivery, Space } from "./schema";

function spaceWithDelivery(delivery: Delivery): Space {
  const s = emptySpace();
  s.deliveries.push(delivery);
  return s;
}

test("a rejected-at moment on the losing record survives onto the delivery the fold keeps", () => {
  // The loser: produced earlier, but it is the copy the person acted on.
  const rejectedEarlier = {
    id: "delivery-TEP-12",
    cutId: "cut-12",
    branch: "tandem/TEP-12",
    proofs: [],
    runId: "TEP-12@earlier",
    producedAt: "2026-08-24T09:00:00.000Z",
    rejectedAt: "2026-08-24T09:30:00.000Z",
  } as unknown as Delivery;
  // The winner: a later run's report, carrying no rejection of its own.
  const winnerNoRejection = {
    id: "delivery-TEP-12",
    cutId: "cut-12",
    branch: "tandem/TEP-12",
    proofs: [],
    runId: "TEP-12@later",
    producedAt: "2026-08-24T10:00:00.000Z",
  } as unknown as Delivery;

  const recLoser: SnapshotRecord = {
    at: "2026-08-24T09:35:00.000Z",
    author: "alice",
    kind: "snapshot",
    space: spaceWithDelivery(rejectedEarlier),
    cut: [],
  };
  const recWinner: SnapshotRecord = {
    at: "2026-08-24T10:05:00.000Z",
    author: "bob",
    kind: "snapshot",
    space: spaceWithDelivery(winnerNoRejection),
    cut: [],
  };

  const folded = foldSpaces([recLoser, recWinner]);
  const kept = folded.deliveries.find((d) => d.id === "delivery-TEP-12");
  assert.ok(kept, "the delivery survives the fold");
  assert.equal(
    (kept as unknown as { runId?: string }).runId,
    "TEP-12@later",
    "the later run's report is the one kept",
  );
  assert.equal(
    kept!.rejectedAt,
    "2026-08-24T09:30:00.000Z",
    "the person's rejection is not lost to a later run's report",
  );

  // And in the other arrival order — the fact is a property of the pair,
  // not of which record happened to be read first.
  const foldedReverse = foldSpaces([recWinner, recLoser]);
  const keptReverse = foldedReverse.deliveries.find((d) => d.id === "delivery-TEP-12");
  assert.ok(keptReverse, "the delivery survives the fold in reverse order too");
  assert.equal(
    keptReverse!.rejectedAt,
    "2026-08-24T09:30:00.000Z",
    "the rejection still rides along in the other order",
  );
});
