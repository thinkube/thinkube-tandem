/**
 * TRANSITION — renderTepBody used to render only the asks and the changes;
 * this pins the addition of a Documentation section that names, up front in
 * the TEP body a worker reads, every docs/ path the cut's members ground —
 * so a worker's brief carries the documentation duty, not just the code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTepBody } from "./briefs";
import { emptySpace } from "../core/schema";

/** A space with one ask and one member grounded in one docs/ path and one src/ path. */
function spaceWithDocsTouchpoint() {
  return {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "document the greet module", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "a greet module gains a docs page",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
        grounding: {
          touchpoints: [
            { path: "src/greet.ts", planned: true },
            { path: "docs/modules/ROOT/pages/greet.adoc", planned: true },
          ],
          stamp: [],
        },
      },
    ],
  };
}

test("renderTepBody names every docs/ path the cut will land in a Documentation section", () => {
  const space = spaceWithDocsTouchpoint() as never;
  const cut = { id: "cut-1", changeIds: ["n1"], tepId: "TEP-t-1" } as never;
  const body = renderTepBody(space, cut);
  assert.match(body, /## Documentation/, "the body carries a Documentation section");
  assert.match(
    body,
    /docs\/modules\/ROOT\/pages\/greet\.adoc/,
    "the section names the docs/ path the cut grounds",
  );
});

test("renderTepBody's Documentation section lists every docs/ path when a cut grounds more than one", () => {
  const space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "document two things", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "a change touching two docs pages",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: {
          touchpoints: [
            { path: "docs/modules/ROOT/pages/one.adoc", planned: true },
            { path: "docs/modules/ROOT/pages/two.adoc", planned: true },
          ],
          stamp: [],
        },
      },
    ],
  } as never;
  const cut = { id: "cut-1", changeIds: ["n1"], tepId: "TEP-t-2" } as never;
  const body = renderTepBody(space, cut);
  assert.match(body, /docs\/modules\/ROOT\/pages\/one\.adoc/);
  assert.match(body, /docs\/modules\/ROOT\/pages\/two\.adoc/);
});
