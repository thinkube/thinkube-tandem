/**
 * TRANSITION — the delivery page's Checks section must name every
 * acceptance criterion of the cut's promises, one per line with its
 * verdict — including a criterion no proof mentions, said as "not
 * checked". Before this, the section only ever listed delivery.proofs, so
 * a criterion nothing judged was simply absent from the page rather than
 * named as unchecked. Done once the page's own text carries every
 * criterion; a regression back to "proofs only" drops this line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "./render";
import { emptySpace } from "../core/schema";
import type { Delivery, Space } from "../core/schema";

test("renderDeliveryPage's Checks section names every criterion, including one no proof mentions", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the delivery page lists every criterion",
        serves: [],
        needs: [],
        acceptance: [
          { id: "c1", text: "a proved criterion shows green" },
          { id: "c2", text: "an unproved criterion shows as not checked" },
        ],
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"] }],
  };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut-1",
    branch: "b",
    proofs: [{ kind: "probe", label: "a proved criterion shows green", verdict: "green", criterionId: "c1" }],
  };

  const page = renderDeliveryPage(space, delivery);

  assert.match(page, /## Checks/, "the page still carries a Checks section");
  assert.match(page, /a proved criterion shows green/, "the checked criterion's own words are on the page");
  assert.match(
    page,
    /an unproved criterion shows as not checked[\s\S]*not checked|not checked[\s\S]*an unproved criterion shows as not checked/,
    "the criterion no proof mentions is named on the page, with the verdict 'not checked'",
  );
});
