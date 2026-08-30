/**
 * INVARIANT — landing on flow shows the report exactly when there is one:
 * nextView on a "reader-tab" event onto "flow" must return the report view
 * when hasReport is true, and the workers view when it is false, so the
 * Workers/Delivery-report choice reflects what is actually there to show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextView, ViewState } from "./viewMove";

test("a reader-tab event onto flow picks report or workers from hasReport", () => {
  const state: ViewState = { tab: "write", flowView: "workers", awaited: null };

  const withReport = nextView(state, { kind: "reader-tab", tab: "flow", hasReport: true });
  assert.equal(withReport.flowView, "report", "flow with a report must show the report view");

  const withoutReport = nextView(state, { kind: "reader-tab", tab: "flow", hasReport: false });
  assert.equal(withoutReport.flowView, "workers", "flow with no report must show the workers view");
});
