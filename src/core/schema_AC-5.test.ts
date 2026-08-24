/**
 * TRANSITION — the delivery page does not yet open with which run produced
 * it. This proves renderDeliveryPage puts the delivery's run id and its
 * produced-at time in the page's opening lines, before any section heading
 * — a reader must see who produced the report before reading what it says.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace } from "./schema";
import type { Delivery } from "./schema";

test("renderDeliveryPage opens with the run id and produced-at time, before any section heading", () => {
  const space = emptySpace();
  const delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [],
    runId: "TEP-1@abc123",
    producedAt: "2026-08-24T10:00:00.000Z",
  } as unknown as Delivery;

  const page = renderDeliveryPage(space, delivery);
  const lines = page.split("\n");
  const firstHeading = lines.findIndex((l) => l.trim().startsWith("##"));
  const runIdLine = lines.findIndex((l) => l.includes("TEP-1@abc123"));
  const producedAtLine = lines.findIndex((l) => l.includes("2026-08-24T10:00:00.000Z"));

  assert.ok(runIdLine >= 0, "the run id appears on the page");
  assert.ok(producedAtLine >= 0, "the produced-at time appears on the page");
  assert.ok(
    firstHeading === -1 || (runIdLine < firstHeading && producedAtLine < firstHeading),
    "both appear before any section heading (## ...)",
  );
});
