/**
 * TRANSITION — a delivery with no run id or produced-at (one produced
 * before run stamping existed) renders with no mention of that gap. This
 * proves renderDeliveryPage says plainly the run was not recorded, instead
 * of silently leaving the line out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace } from "./schema";
import type { Delivery } from "./schema";

test("renderDeliveryPage says the run was not recorded when the delivery carries no run id or produced-at", () => {
  const space = emptySpace();
  const delivery: Delivery = {
    id: "delivery-TEP-old",
    cutId: "cut-1",
    branch: "tandem/TEP-old",
    proofs: [],
  };

  const page = renderDeliveryPage(space, delivery);
  assert.match(
    page,
    /run.*not recorded/i,
    `the page should say plainly the run was not recorded — got:\n${page.split("\n").slice(0, 6).join("\n")}`,
  );
});
