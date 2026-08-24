/**
 * TRANSITION — folding a delivery that carries no produced-at against one
 * with the same id that does used to keep whichever arrived first, so the
 * space could present a delivery with no run identity as current over a
 * stamped report of the same work. This proves the STAMPED one is kept
 * whichever order the two are folded in.
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

const unstamped: Delivery = {
  id: "delivery-TEP-14",
  cutId: "cut-14",
  branch: "tandem/TEP-14",
  proofs: [],
};
const stamped = {
  id: "delivery-TEP-14",
  cutId: "cut-14",
  branch: "tandem/TEP-14",
  proofs: [],
  runId: "TEP-14@stamped",
  producedAt: "2026-08-24T10:00:00.000Z",
} as unknown as Delivery;

function record(author: string, at: string, delivery: Delivery): SnapshotRecord {
  return { at, author, kind: "snapshot", space: spaceWithDelivery(delivery), cut: [] };
}

test("folding keeps the stamped delivery over an unstamped one with the same id, in either order", () => {
  const unstampedFirst = foldSpaces([
    record("alice", "2026-08-24T09:00:00.000Z", unstamped),
    record("bob", "2026-08-24T10:05:00.000Z", stamped),
  ]);
  const keptA = unstampedFirst.deliveries.find((d) => d.id === "delivery-TEP-14");
  assert.ok(keptA, "the delivery survives the fold");
  assert.equal(
    (keptA as unknown as { producedAt?: string }).producedAt,
    "2026-08-24T10:00:00.000Z",
    "the stamped delivery is kept when the unstamped one is folded first",
  );
  assert.equal(
    (keptA as unknown as { runId?: string }).runId,
    "TEP-14@stamped",
    "and it carries the run that produced it",
  );

  const stampedFirst = foldSpaces([
    record("bob", "2026-08-24T10:05:00.000Z", stamped),
    record("alice", "2026-08-24T09:00:00.000Z", unstamped),
  ]);
  const keptB = stampedFirst.deliveries.find((d) => d.id === "delivery-TEP-14");
  assert.ok(keptB, "the delivery survives the fold in the other order");
  assert.equal(
    (keptB as unknown as { producedAt?: string }).producedAt,
    "2026-08-24T10:00:00.000Z",
    "the stamped delivery is kept when it is folded first",
  );
  assert.equal(
    (keptB as unknown as { runId?: string }).runId,
    "TEP-14@stamped",
    "and it still carries the run that produced it",
  );
});
