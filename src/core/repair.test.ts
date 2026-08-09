import { test } from "node:test";
import assert from "node:assert/strict";
import { repairClaimIds } from "./repair";
import { Space } from "./schema";

/** A space whose claim ids were minted twice, with promises on both. */
function corrupt(): Space {
  return {
    asks: [],
    nodes: [
      {
        id: "node-a-1-1",
        sentence: "the page prints the reason",
        serves: ["subject-a-1"],
        needs: [],
        servesClaim: "claim-a-3",
        acceptance: [],
      },
      {
        id: "node-a-2-1",
        sentence: "the TEP records the reason",
        serves: ["subject-a-2"],
        needs: [],
        servesClaim: "claim-a-3",
        acceptance: [],
      },
    ],
    questions: [],
    cuts: [],
    impacts: [],
    units: [],
    deliveries: [],
    pins: [],
    subjects: [
      { id: "subject-a-1", name: "the delivery page", from: [] },
      { id: "subject-a-2", name: "the TEP", from: [] },
    ],
    claims: [
      { id: "claim-a-3", subjectId: "subject-a-1", text: "prints the reason", fromAsk: "" },
      { id: "claim-a-3", subjectId: "subject-a-2", text: "records the reason", fromAsk: "" },
    ],
  } as Space;
}

test("a claim id minted twice is made unique, and each promise keeps its own claim", () => {
  const fixed = repairClaimIds(corrupt());
  const ids = (fixed.claims ?? []).map((c) => c.id);
  assert.equal(new Set(ids).size, 2, "the two claims no longer share one id");
  const first = (fixed.claims ?? []).find((c) => c.subjectId === "subject-a-1")!;
  const second = (fixed.claims ?? []).find((c) => c.subjectId === "subject-a-2")!;
  // Each promise follows the claim of the subject it was derived for —
  // decided from the record, not guessed.
  assert.equal(fixed.nodes[0].servesClaim, first.id);
  assert.equal(fixed.nodes[1].servesClaim, second.id);
});

test("a promise whose subject cannot be decided loses the link instead of pointing anywhere", () => {
  const sp = corrupt();
  sp.nodes[1] = { ...sp.nodes[1], serves: ["ask-a-9"] };
  const fixed = repairClaimIds(sp);
  assert.equal(fixed.nodes[1].servesClaim, undefined);
});

test("a record with unique claim ids is returned untouched", () => {
  const sp = corrupt();
  sp.claims = [{ id: "claim-a-1", subjectId: "subject-a-1", text: "x", fromAsk: "" }];
  assert.equal(repairClaimIds(sp), sp);
});
