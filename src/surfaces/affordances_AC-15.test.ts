/**
 * INVARIANT — renderDeliveryPage prints no "see it" line for a promise
 * absent from the experience map it is given, so a delivery page never
 * points a reader at a way in nobody proved exists.
 *
 * This must hold for as long as the experience map is the sole source of
 * "see it" lines: any promise the map does not carry is passed over in
 * silence at that line, never guessed at.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace, Delivery } from "../core/schema";

test("renderDeliveryPage prints no see it line for a promise absent from the given experience map", () => {
  const space = {
    ...emptySpace(),
    subjects: [{ id: "s1", name: "the greeting", from: [] }],
    claims: [{ id: "c1", subjectId: "s1", text: "the app greets the user", fromAsk: "a1" }],
    asks: [{ id: "a1", text: "greet the user", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "add a greet() function",
        serves: ["a1"],
        servesClaim: "c1",
        needs: [],
        acceptance: [{ id: "ac1", text: "greet() returns hello" }],
      },
    ],
  };
  const cut = { id: "cut1", changeIds: ["n1"] };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut1",
    branch: "b1",
    proofs: [{ kind: "probe", label: "greet() returns hello", verdict: "green", criterionId: "ac1" }],
  };
  const fullSpace = { ...space, cuts: [cut] };

  // The experience map is empty — nothing was proved to render.
  const page = renderDeliveryPage(fullSpace, delivery, new Map());

  assert.ok(!page.includes("see it"), "no see it line is printed when the experience map carries nothing for this promise");
});
