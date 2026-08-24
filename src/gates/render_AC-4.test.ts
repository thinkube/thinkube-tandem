/**
 * TRANSITION — before this slice a cut with no docs/ path had no way to say
 * it did not need one. This pins that a docs waiver with a reason makes
 * renderCutScreen print Documentation as not needed, carrying that reason,
 * so a signer sees WHY no page is coming rather than reading a bare cut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen prints Documentation as not needed with the recorded reason when the cut carries a docs waiver", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change with no documentation to write",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: { touchpoints: [{ path: "src/only.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsWaiver: { reason: "internal refactor, nothing user-facing changed", at: "2026-08-24T00:00:00Z" },
  };
  const screen = renderCutScreen(space as never, cut as never);
  assert.match(screen, /Documentation/);
  assert.match(screen, /not needed/i, "documentation is reported as not needed");
  assert.match(
    screen,
    /internal refactor, nothing user-facing changed/,
    "the recorded reason is printed beside the not-needed line",
  );
});
