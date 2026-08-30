/**
 * TRANSITION — renderDeliveryBody is a new export: the pull-request body,
 * pulled onto one renderer so the forge face and the accept page cannot say
 * different things. It must carry everything today's hand-built body
 * carries — what only a person can certify, and every undelivered line —
 * beside the new complete list of criteria with their verdicts. Its job is
 * done once all three sections are present; a render that drops one of them
 * silently loses a section the forge body used to carry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryBody } from "./render";
import { emptySpace } from "../core/schema";
import type { Delivery, Space } from "../core/schema";

test("renderDeliveryBody prints observations, undelivered lines, and every criterion with its verdict", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the pull request body carries the full account",
        serves: [],
        needs: [],
        acceptance: [
          { id: "c1", text: "a green criterion appears with its verdict" },
          { id: "c2", text: "an unchecked criterion appears too" },
        ],
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"] }],
  };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut-1",
    branch: "b",
    proofs: [{ kind: "probe", label: "a green criterion appears with its verdict", verdict: "green", criterionId: "c1" }],
    observations: ["only a person can see this — the running product must show it"],
    undelivered: ["SL-2#eu-1: the docs page was not updated"],
  };

  const body = renderDeliveryBody(space, delivery);

  assert.match(body, /only a person can see this/, "the observation is printed");
  assert.match(body, /CERTIFY|certify/i, "under a heading a person can read as 'for you to certify'");
  assert.match(body, /SL-2#eu-1: the docs page was not updated/, "every undelivered line is printed");
  assert.match(body, /a green criterion appears with its verdict/, "the green criterion is named");
  assert.match(body, /an unchecked criterion appears too/, "the unchecked criterion is named too");
  assert.match(body, /not checked/, "and carries the 'not checked' verdict, not silence");
});
