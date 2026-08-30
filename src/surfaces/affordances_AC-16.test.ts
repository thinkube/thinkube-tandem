/**
 * TRANSITION — renderDeliveryPage prints a "see it" line naming the page
 * label and gesture for a promise present in the experience map it is
 * given, so a proved door reaches the reader's own delivery page.
 *
 * This pins the positive counterpart to AC-15: when the experience map
 * carries a line for a promise's node id, that exact line appears on the
 * rendered page under the claim it proves. Its job is done once
 * renderDeliveryPage reads "see it" lines only from the given map.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "../gates/render";
import { emptySpace, Delivery } from "../core/schema";

test("renderDeliveryPage prints a see it line naming the page label and gesture for a promise present in the experience map", () => {
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
    cuts: [{ id: "cut1", changeIds: ["n1"] }],
  };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut1",
    branch: "b1",
    proofs: [{ kind: "probe", label: "greet() returns hello", verdict: "green", criterionId: "ac1" }],
  };

  const experience = new Map([["n1", "the work page — press Build"]]);
  const page = renderDeliveryPage(space, delivery, experience);

  assert.ok(
    page.includes("see it: the work page — press Build"),
    "the page's own see it line names the page label and gesture from the experience map",
  );
});
