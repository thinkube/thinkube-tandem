/**
 * INVARIANT — the page of a delivery carrying a run stamp names that run's
 * id and its produced-at time above the first '##' section, so an older
 * run's report is never mistaken for the one that just finished.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace } from "./schema";
import type { Delivery, Space } from "./schema";

function spaceWithCut(): Space {
  return {
    ...emptySpace(),
    cuts: [{ id: "cut-1", changeIds: [] }],
  };
}

test("the delivery page names the producing run's id and produced-at time above the first '##' section", () => {
  const space = spaceWithCut();
  const delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
    runId: "TEP-1@abc123",
    producedAt: "2026-08-24T10:00:00.000Z",
  } as unknown as Delivery;

  const page = renderDeliveryPage(space, delivery);

  const firstSectionIdx = page.indexOf("\n## ");
  assert.ok(firstSectionIdx >= 0, `the page has no '##' section to be above: ${page}`);
  const header = page.slice(0, firstSectionIdx);

  assert.ok(header.includes("TEP-1@abc123"), `run id is not above the first '##' section:\n${header}`);
  assert.ok(header.includes("2026-08-24T10:00:00.000Z"), `produced-at is not above the first '##' section:\n${header}`);
});
