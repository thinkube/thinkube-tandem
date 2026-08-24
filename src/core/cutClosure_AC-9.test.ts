/**
 * INVARIANT — a delivery of a cut that recorded why documentation is not
 * needed must never be refused for an unmet documentation obligation: the
 * sign gate already accepted that reason as settling "does this cut need
 * documentation", and the accept gate must read the same recorded answer
 * instead of asking again behind docsGateMode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptDelivery } from "../gates/sign";
import type { Delivery, Cut } from "./schema";

const cutWithReason: Cut = {
  id: "cut-1",
  changeIds: ["n1"],
  docsNotNeeded: "this change touches only internal test fixtures",
};

const delivery: Delivery = {
  id: "d1",
  cutId: "cut-1",
  branch: "tandem/space/TEP-1",
  proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
  undelivered: ["SL-5: docs obligation unmet: declared doc-module path(s) not present in the landed tree: ENGINE-WIRING.md."],
};

test("a delivery of a cut that recorded why documentation is not needed is not refused for an unmet documentation obligation, even under a blocking docs gate", () => {
  const r = acceptDelivery(delivery, "2026-08-24T00:00:00Z", "blocking", [], cutWithReason);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
