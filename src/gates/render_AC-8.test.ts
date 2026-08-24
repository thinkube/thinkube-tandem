/**
 * INVARIANT — a docs waiver only stands in for missing documentation, never
 * overrides documentation that is actually there: a cut whose member grounds
 * a docs/ path is reported documented even when it also carries a waiver
 * (e.g. left over from before the docs page was grounded), so the page
 * never tells a signer "not needed" about a page the cut in fact writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen reports documented, not not-needed, when the cut has both a docs/ path and a docs waiver", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change that documents itself after all",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: { touchpoints: [{ path: "docs/after-all.adoc", planned: true }], stamp: [] },
      },
    ],
  };
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsWaiver: { reason: "stale waiver from an earlier draft of this cut", at: "2026-08-24T00:00:00Z" },
  };
  const screen = renderCutScreen(space as never, cut as never);
  assert.match(screen, /docs\/after-all\.adoc/, "the actual docs path is named");
  assert.doesNotMatch(screen, /not needed/i, "the cut is not reported not-needed when it does write documentation");
});
