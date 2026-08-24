/**
 * TRANSITION — the command-line journey's closing report today assumes the
 * LAST delivery in the space's array is the outcome of the run that just
 * finished. This proves that, given a space whose newest delivery carries a
 * run id other than the run just finished, the journey's closing lines name
 * the run id and produced-at of the delivery they are ACTUALLY reporting —
 * never presenting a delivery an earlier run left behind as though it were
 * this run's outcome.
 *
 * `main(argv)` takes no injectable deps and drives a real derivation round,
 * so this exercises the pure decision `journey.ts` must make to satisfy the
 * criterion: which delivery, and which words, close the report for a given
 * run id and a given list of the space's deliveries. `closingReportOf` is
 * the seam this test requires of src/cli/journey.ts (see DECISION in the
 * final summary).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closingReportOf } from "../cli/journey";
import type { Delivery } from "../core/schema";

test("the journey's closing lines name the run id and produced-at of the delivery actually being reported, not the run just finished", () => {
  const staleFromEarlierRun: Delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [{ kind: "suite", label: "repo suite", verdict: "green" }],
    ...({ runId: "TEP-1@earlier", producedAt: "2026-08-24T07:00:00.000Z" } as unknown as Partial<Delivery>),
  };

  // The run that just finished (this journey's own run) carries a
  // DIFFERENT id — e.g. it refused before ever reaching a delivery, or
  // this space was already holding an older delivery no run since renewed.
  const report = closingReportOf([staleFromEarlierRun], "TEP-1@just-finished");

  assert.match(report, /TEP-1@earlier/, "the closing lines name the run id of the delivery being reported");
  assert.match(report, /2026-08-24T07:00:00\.000Z/, "the closing lines name its produced-at moment");
  assert.doesNotMatch(
    report,
    /TEP-1@just-finished/,
    "the closing lines never claim the delivery as the outcome of the run just finished",
  );
});
