/**
 * TRANSITION — a cut that lands no docs/ path and carries no waiver used to
 * be rendered as if documentation were simply not a topic. This pins that
 * renderCutScreen now prints Documentation as missing, with what to do,
 * so the gap is visible before signing rather than discovered at the gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen prints Documentation as missing, with what to do, when the cut writes no docs/ path and carries no waiver", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change grounded only in source",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: { touchpoints: [{ path: "src/only.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1"] } as never);
  assert.match(screen, /Documentation/);
  assert.match(screen, /missing/i, "documentation is reported as missing");
  assert.match(
    screen,
    /not needed|waive|reason/i,
    "the line says what to do — record a reason it is not needed",
  );
});
