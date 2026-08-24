/**
 * TRANSITION — the session replaced the delivery it held for a cut with
 * whatever the latest report carried, while the fold across authors' records
 * preferred the run that produced LAST. Two surfaces settling the same pair
 * by different rules meant a slow older run reporting after a newer one
 * replaced a current report with a stale one on the page, while the folded
 * space still showed the newer. This proves the session's onDelivery keeps
 * the delivery it holds when the arriving one is older, replaces it when the
 * arriving one is newer, and lands on the SAME delivery foldSpaces does for
 * that pair.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { settleDelivery, foldSpaces } from "./records";
import { emptySpace } from "./schema";
import type { SnapshotRecord } from "./records";
import type { Delivery, Space } from "./schema";

const older = {
  id: "delivery-TEP-13",
  cutId: "cut-13",
  branch: "tandem/TEP-13",
  proofs: [],
  runId: "TEP-13@older",
  producedAt: "2026-08-24T09:00:00.000Z",
} as unknown as Delivery;

const newer = {
  id: "delivery-TEP-13",
  cutId: "cut-13",
  branch: "tandem/TEP-13",
  proofs: [],
  runId: "TEP-13@newer",
  producedAt: "2026-08-24T11:00:00.000Z",
} as unknown as Delivery;

function spaceWithDelivery(delivery: Delivery): Space {
  const s = emptySpace();
  s.deliveries.push(delivery);
  return s;
}

function foldOf(first: Delivery, second: Delivery): Delivery {
  const recs: SnapshotRecord[] = [
    { at: "2026-08-24T09:05:00.000Z", author: "alice", kind: "snapshot", space: spaceWithDelivery(first), cut: [] },
    { at: "2026-08-24T11:05:00.000Z", author: "bob", kind: "snapshot", space: spaceWithDelivery(second), cut: [] },
  ];
  const folded = foldSpaces(recs);
  const d = folded.deliveries.find((x) => x.id === "delivery-TEP-13");
  assert.ok(d, "the fold returns the delivery");
  return d!;
}

test("onDelivery keeps the held delivery when an older one arrives", () => {
  const settled = settleDelivery(newer, older);
  assert.equal(
    (settled as unknown as { runId?: string }).runId,
    "TEP-13@newer",
    "the newer delivery the space already holds is kept when an older report arrives",
  );
});

test("onDelivery replaces the held delivery when a newer one arrives", () => {
  const settled = settleDelivery(older, newer);
  assert.equal(
    (settled as unknown as { runId?: string }).runId,
    "TEP-13@newer",
    "the arriving newer delivery replaces the older one the space held",
  );
});

test("onDelivery and foldSpaces settle the same pair the same way", () => {
  // Held newer, older arrives.
  assert.equal(
    (settleDelivery(newer, older) as unknown as { runId?: string }).runId,
    (foldOf(newer, older) as unknown as { runId?: string }).runId,
    "the session and the fold agree when the older report arrives second",
  );
  // Held older, newer arrives.
  assert.equal(
    (settleDelivery(older, newer) as unknown as { runId?: string }).runId,
    (foldOf(older, newer) as unknown as { runId?: string }).runId,
    "the session and the fold agree when the newer report arrives second",
  );
  // Both land on the run that produced last, in either direction.
  for (const pair of [
    [newer, older],
    [older, newer],
  ] as const) {
    assert.equal(
      (settleDelivery(pair[0], pair[1]) as unknown as { runId?: string }).runId,
      "TEP-13@newer",
      "the run that produced last is the one that stands",
    );
  }
});
