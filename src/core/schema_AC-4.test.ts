/**
 * INVARIANT — a delivery carrying no run id and no produced-at stamp (an
 * old record, from before this field existed) must always render a page
 * whose opening lines say PLAINLY that the run which produced it was not
 * recorded — never silently omitting the statement, and never presenting
 * the delivery as though it were the newest run's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace, Delivery, Space } from "../core/schema";

function spaceWith(delivery: Delivery): Space {
  const s = emptySpace();
  return {
    ...s,
    cuts: [{ id: "cut-1", changeIds: [], tepId: "TEP-1" }],
    deliveries: [delivery],
  };
}

test("a delivery with no run id and no produced-at states plainly that the run was not recorded", () => {
  const delivery: Delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [{ kind: "suite", label: "repo suite", verdict: "green" }],
    // Deliberately no runId / producedAt — an old record, from before the run
    // identity existed.
  };
  const page = renderDeliveryPage(spaceWith(delivery), delivery);
  const lines = page.split("\n");
  const firstSectionIdx = lines.findIndex((l) => l.startsWith("## "));
  const opening = (firstSectionIdx > 0 ? lines.slice(0, firstSectionIdx) : lines).join("\n");
  assert.match(
    opening,
    /produced by a run this space did not record/i,
    "the opening states plainly that the run was not recorded, per the decision in force",
  );
});
