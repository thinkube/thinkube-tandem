/**
 * A judgement that cannot withhold must still be said.
 *
 * Two rules meet here and cancelled each other. A promise the machine
 * minted for itself informs and never vetoes, so `unkeptProof` keeps it out
 * of the unkept list. The findings — what nobody is left to settle — were
 * then read from that same list. A red machine-minted promise was therefore
 * excluded from the veto AND from the report: it left the gate as one ✗
 * beneath a hundred and eighty-eight ticks, in a section nobody reads for
 * decisions, while "For you to weigh" stood empty.
 *
 * That is how a delivery was handed over carrying two criteria that were
 * red, real, and unmentioned.
 *
 * A withheld delivery is read too, and by someone deciding what to do next.
 * Three of the four were written out by hand and two of those dropped the
 * observations and findings entirely.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unsettledReviews, withheldDelivery } from "./withheld";
import { unkeptProof } from "../core/schema";

const red = (label: string, criterionId: string, ref?: string) =>
  ({ kind: "assessment", label, verdict: "red", criterionId, ...(ref ? { ref } : {}) }) as never;

test("a red the machine minted for itself cannot withhold, and is still said", () => {
  const p = red("review-33: only one declaration of the union exists", "node-cmxela-gap-4-check-2", "RED: viewMove.ts declares its own copy");

  assert.equal(unkeptProof(p), false, "the machine's own housekeeping never holds back the person's work");
  assert.deepEqual(
    unsettledReviews([p]).map((r) => r.label),
    ["review-33: only one declaration of the union exists"],
    "and it reaches the report anyway — informing instead of vetoing means informing",
  );
});

test("the person's own red review is said too", () => {
  const p = red("review-3: an in-cut card still reads as in the cut", "node-cmxela-15-2-check-1");
  assert.equal(unkeptProof(p), true);
  assert.equal(unsettledReviews([p]).length, 1);
});

test("a check is not a review — it withholds, and is not demoted to a note", () => {
  const probe = { kind: "probe", label: "the handle appears", verdict: "red", criterionId: "c1" } as never;
  assert.deepEqual(unsettledReviews([probe]), [], "an unkept promise is the one thing this gate never hands over");
});

test("a kept review says nothing", () => {
  const green = { kind: "assessment", label: "review-1: it holds", verdict: "green" } as never;
  assert.deepEqual(unsettledReviews([green]), []);
});

test("the finding carries the reviewer's first line, not its whole reading", () => {
  const [r] = unsettledReviews([red("review-9: x", "c", "RED — the first line\nand a second nobody needs here")]);
  assert.match(r.line, /RED — the first line/);
  assert.doesNotMatch(r.line, /a second nobody needs/);
});

test("a withheld delivery carries what the person is being asked to weigh", () => {
  const d = withheldDelivery({
    tep: "TEP-1",
    cut: { id: "cut-1" } as never,
    branch: "tandem/x",
    runId: "r1",
    producedAt: "2026-08-31T12:00:00Z",
    proofs: [],
    reason: "2 of the cut's promises are not kept",
    observations: ["watch the run page redraw"],
    findings: ["review-33: only one declaration of the union exists"],
    undelivered: ["SL-2: the docs line"],
  });

  assert.deepEqual(d.findings, ["review-33: only one declaration of the union exists"], "a withheld report is still read");
  assert.deepEqual(d.observations, ["watch the run page redraw"]);
  assert.deepEqual(d.undelivered, ["SL-2: the docs line"]);
  assert.equal(d.id, "delivery-TEP-1");
  assert.match(d.withheld ?? "", /are not kept/);
});

test("nothing empty is written onto a withheld delivery", () => {
  const d = withheldDelivery({
    tep: "TEP-1", cut: { id: "cut-1" } as never, branch: "b", runId: "r", producedAt: "t",
    proofs: [], reason: "stopped", observations: [], findings: [], undelivered: [],
  });
  for (const k of ["observations", "findings", "undelivered", "rulings", "decisions"])
    assert.equal(k in d, false, `an empty ${k} is noise on the page`);
});
