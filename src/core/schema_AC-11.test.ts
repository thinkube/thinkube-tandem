/**
 * TRANSITION — two authors each holding a record of the SAME delivery (same
 * id, cut and branch) differing only in the run that produced it used to be
 * read as a content collision, and the collision escape qualified one of
 * them with its author's name. That turned one delivery into two, each
 * named after a person, for a difference that is only "which run reported
 * last". This proves the fold returns exactly ONE delivery for that cut,
 * and that neither copy is renamed with its author.
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

test("two authors' records of one delivery differing only in run id fold to exactly one delivery, unrenamed", () => {
  const base = {
    id: "delivery-TEP-11",
    cutId: "cut-11",
    branch: "tandem/TEP-11",
    proofs: [],
  };
  const fromAlice = {
    ...base,
    runId: "TEP-11@earlier",
    producedAt: "2026-08-24T09:00:00.000Z",
  } as unknown as Delivery;
  const fromBob = {
    ...base,
    runId: "TEP-11@later",
    producedAt: "2026-08-24T10:00:00.000Z",
  } as unknown as Delivery;

  const recAlice: SnapshotRecord = {
    at: "2026-08-24T09:05:00.000Z",
    author: "alice",
    kind: "snapshot",
    space: spaceWithDelivery(fromAlice),
    cut: [],
  };
  const recBob: SnapshotRecord = {
    at: "2026-08-24T10:05:00.000Z",
    author: "bob",
    kind: "snapshot",
    space: spaceWithDelivery(fromBob),
    cut: [],
  };

  const folded = foldSpaces([recAlice, recBob]);

  const forCut = folded.deliveries.filter((d) => d.cutId === "cut-11");
  assert.equal(forCut.length, 1, "exactly one delivery survives the fold for that cut");

  // Neither copy was qualified with its author — the collision escape writes
  // "<id>~<author>", and a delivery differing only by run must never take it.
  for (const d of folded.deliveries) {
    assert.ok(
      !d.id.includes("~"),
      `the delivery id was qualified with an author's name: "${d.id}"`,
    );
    assert.ok(
      !d.id.includes("alice") && !d.id.includes("bob"),
      `the delivery id carries an author's name: "${d.id}"`,
    );
  }
  assert.equal(forCut[0].id, "delivery-TEP-11", "the delivery keeps its own id");
});
