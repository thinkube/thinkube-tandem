/**
 * TRANSITION — renderCutScreen gains a documentation section: for a cut
 * that carries a recorded docs exemption, the review page must state that
 * documentation is not needed and print the recorded reason verbatim, so
 * the person reads the same reason they are about to sign. This test's
 * job is done once that section exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen states that documentation is not needed for an exempt cut and prints the recorded reason verbatim", () => {
  const REASON = "this cut only renames an internal helper — no doc page describes it";
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "rename the internal helper",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the helper is renamed everywhere" }],
        grounding: { touchpoints: [{ path: "src/internal/helper.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason: REASON, at: "2026-08-24T00:00:00Z" },
  };
  const screen = renderCutScreen(space as never, cut as never);
  assert.match(screen, /documentation/i, "the page speaks about documentation");
  assert.match(screen, /not needed/i, "the page states documentation is not needed");
  assert.ok(screen.includes(REASON), "the recorded reason appears verbatim, not paraphrased");
});
