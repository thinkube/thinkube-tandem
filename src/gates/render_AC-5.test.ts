/**
 * INVARIANT — a docs waiver only speaks for a cut that actually writes no
 * docs/ path. When a member already grounds documentation, the waiver's
 * reason must not be printed as if it excused an absence that is not real —
 * the page would then tell the signer the cut skips docs it is in fact
 * writing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen does not print the waiver's not-needed reason when the cut already grounds a docs/ path", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change that documents itself",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: { touchpoints: [{ path: "docs/self.adoc", planned: true }], stamp: [] },
      },
    ],
  };
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsWaiver: { reason: "should never surface here", at: "2026-08-24T00:00:00Z" },
  };
  const screen = renderCutScreen(space as never, cut as never);
  assert.match(screen, /docs\/self\.adoc/, "the actual docs path is named");
  assert.doesNotMatch(
    screen,
    /should never surface here/,
    "a waiver reason is not shown for a cut that already writes documentation",
  );
});
