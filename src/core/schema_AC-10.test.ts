/**
 * INVARIANT — the block the headless run prints when it finishes names
 * which run produced the delivery and when, for a delivery carrying a run
 * stamp; for a delivery with no stamp it says the producing run was not
 * recorded — so an earlier block still on screen is never read as the run
 * that just ended.
 *
 * main() has no seam to script its worker without a real model call, so
 * this drives the same delivery-block formatting main() prints through, at
 * the smallest unit that can carry the property: given a delivery, what
 * text does the headless run's finishing block contain.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDeliveryBlock } from "../cli/headless";
import type { Delivery } from "./schema";

const baseCut = { tepId: "TEP-headless-1", id: "cut-1" };

test("the finishing block for a delivery carrying a run stamp names that run's id and produced-at time", () => {
  const delivery = {
    id: "delivery-TEP-headless-1",
    cutId: "cut-1",
    branch: "tandem/TEP-headless-1",
    proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
    runId: "TEP-headless-1@abc123",
    producedAt: "2026-08-24T10:00:00.000Z",
  } as unknown as Delivery;

  const block = formatDeliveryBlock(baseCut as never, { delivery, refusals: [], undelivered: [] } as never);

  assert.ok(block.includes("TEP-headless-1@abc123"), `finishing block does not name the run: ${block}`);
  assert.ok(block.includes("2026-08-24T10:00:00.000Z"), `finishing block does not name when it was produced: ${block}`);
});

test("the finishing block for a delivery with no run stamp says the producing run was not recorded", () => {
  const delivery: Delivery = {
    id: "delivery-TEP-headless-1",
    cutId: "cut-1",
    branch: "tandem/TEP-headless-1",
    proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
  };

  const block = formatDeliveryBlock(baseCut as never, { delivery, refusals: [], undelivered: [] } as never);

  assert.match(block, /not recorded/i, `finishing block does not say the producing run was not recorded: ${block}`);
});
