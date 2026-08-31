/**
 * TRANSITION — a promise whose door or page could not be proved is now
 * named on the delivery page instead of quietly losing its "see it" line:
 * the registry's own rule is that such a claim is undelivered and named,
 * not silently unmentioned.
 *
 * This pins that renderDeliveryPage, given a promise with no proved way in
 * (absent from the experience map) and a delivery whose undelivered list
 * names that promise, prints a line naming the promise and saying its way
 * in could not be proved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace, Delivery } from "../core/schema";

test("the delivery page, given a promise with no proved way in, prints a line naming that promise and saying the way in could not be proved", () => {
  const promiseSentence = "add a greet() function reachable from the surface";
  const space = {
    ...emptySpace(),
    subjects: [{ id: "s1", name: "the greeting", from: [] }],
    claims: [{ id: "c1", subjectId: "s1", text: "the app greets the user", fromAsk: "a1" }],
    asks: [{ id: "a1", text: "greet the user", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: promiseSentence,
        serves: ["a1"],
        servesClaim: "c1",
        needs: [],
        acceptance: [{ id: "ac1", text: "greet() returns hello" }],
      },
    ],
    cuts: [{ id: "cut1", changeIds: ["n1"] }],
  };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut1",
    branch: "b1",
    proofs: [{ kind: "probe", label: "greet() returns hello", verdict: "green", criterionId: "ac1" }],
    undelivered: [`${promiseSentence} — the way in could not be proved`],
  };

  // No experience map entry for n1: the door proof could not show this
  // promise's control (or its page) really renders.
  const page = renderDeliveryPage(space, delivery, new Map());

  assert.ok(
    page.includes(promiseSentence),
    "the page names the promise whose way in could not be proved",
  );
  assert.ok(
    /could not be proved|not proved/i.test(page),
    "the page says the way in could not be proved, rather than staying silent",
  );
});
