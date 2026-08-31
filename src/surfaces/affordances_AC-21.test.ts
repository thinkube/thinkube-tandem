/**
 * TRANSITION — that same promise is named in the delivery's undelivered
 * list, not only mentioned in prose on the page: the registry's rule that
 * an unproved door makes a claim undelivered must show up in the
 * structured field a delivery is judged by, not only in rendered text.
 *
 * This pins that the delivery's own undelivered array (the field
 * renderDeliveryPage's "Not delivered" section reads) names the promise
 * whose way in could not be proved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace, Delivery } from "../core/schema";

test("that same promise is named in the delivery's undelivered list", () => {
  const promiseSentence = "add a greet() function reachable from the surface";
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut1",
    branch: "b1",
    proofs: [],
    undelivered: [`${promiseSentence} — the way in could not be proved`],
  };

  assert.ok(
    delivery.undelivered!.some((u) => u.includes(promiseSentence)),
    "the delivery's own undelivered list names the promise whose door or page could not be proved",
  );

  const space = { ...emptySpace(), cuts: [{ id: "cut1", changeIds: [] as string[] }] };
  const page = renderDeliveryPage(space, delivery, new Map());

  assert.ok(
    page.includes("Not delivered"),
    "the rendered page carries a Not delivered section",
  );
  assert.ok(
    page.includes(promiseSentence),
    "the rendered page's Not delivered section names the same promise",
  );
});
