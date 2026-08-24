/**
 * TRANSITION — folding two authors' records for the same delivery id today
 * keeps whichever run was seen FIRST. This proves the fold now keeps the
 * delivery produced by the NEWER run (by produced-at) instead, with its run
 * id, while acceptance facts (acceptedAt) recorded by the other author are
 * still carried onto the kept delivery.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "../core/records";
import { emptySpace, Delivery, Space } from "../core/schema";
import type { SnapshotRecord } from "../core/records";

function spaceWithDelivery(d: Delivery): Space {
  return { ...emptySpace(), deliveries: [d] };
}

function record(at: string, author: string, space: Space): SnapshotRecord {
  return { at, author, kind: "snapshot", space, cut: [] };
}

test("folding two authors' snapshots keeps the delivery of the newer run, carrying acceptance facts from the other author", () => {
  const older: Delivery = {
    id: "delivery-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [{ kind: "suite", label: "repo suite", verdict: "green" }],
    ...({ runId: "TEP-1@aaa", producedAt: "2026-08-24T08:00:00.000Z" } as unknown as Partial<Delivery>),
  };
  const newer: Delivery = {
    id: "delivery-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [{ kind: "suite", label: "repo suite", verdict: "green" }],
    ...({ runId: "TEP-1@bbb", producedAt: "2026-08-24T09:00:00.000Z" } as unknown as Partial<Delivery>),
  };
  const accepted: Delivery = { ...older, acceptedAt: "2026-08-24T08:30:00.000Z" };

  // foldSpaces takes the LATEST snapshot per author (that per-author
  // reduction is latestPerAuthor's job, upstream of this function) — so
  // each author here contributes exactly one record, its own latest state.
  // Author "alice" saw only the OLDER run and accepted it. Author "bob" ran
  // the cut again afterwards, producing a NEWER delivery neither saw the
  // other make.
  const records: SnapshotRecord[] = [
    record("2026-08-24T08:35:00.000Z", "alice", spaceWithDelivery(accepted)),
    record("2026-08-24T09:05:00.000Z", "bob", spaceWithDelivery(newer)),
  ];

  const folded = foldSpaces(records);
  const kept = folded.deliveries.find((d) => d.id === "delivery-1");
  assert.ok(kept, "the delivery survives the fold");
  const keptTagged = kept as unknown as { runId?: string; producedAt?: string };
  assert.equal(keptTagged.runId, "TEP-1@bbb", "the fold keeps the newer run's identity, not the first one seen");
  assert.equal(keptTagged.producedAt, "2026-08-24T09:00:00.000Z", "the fold keeps the newer run's produced-at");
  assert.equal(
    kept!.acceptedAt,
    "2026-08-24T08:30:00.000Z",
    "acceptance recorded by the other author against the stale delivery still rides the kept one",
  );
});
