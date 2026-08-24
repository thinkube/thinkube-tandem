/**
 * INVARIANT — the page of a delivery with no run stamp says plainly that
 * the producing run was not recorded, rather than leaving the line out —
 * so a reader is told the identity is unknown instead of reading silence
 * as "this is the run that just finished".
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

test("a delivery with no run stamp says the producing run was not recorded", () => {
  const space = spaceWithCut();
  const delivery: Delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
    // deliberately no runId / producedAt — an older delivery record, from
    // before this field existed.
  };

  const page = renderDeliveryPage(space, delivery);

  const firstSectionIdx = page.indexOf("\n## ");
  assert.ok(firstSectionIdx >= 0, `the page has no '##' section to be above: ${page}`);
  const header = page.slice(0, firstSectionIdx);

  assert.match(
    header,
    /not recorded/i,
    `an unstamped delivery must say the producing run was not recorded, above the first section:\n${header}`,
  );
});
