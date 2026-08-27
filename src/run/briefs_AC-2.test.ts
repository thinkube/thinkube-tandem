/**
 * TRANSITION — proves the change landed: renderTepBody now names the docs/
 * paths a non-exempt cut must land, so a brief built from it carries where
 * documentation is owed instead of leaving it to be worked out again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTepBody } from "./briefs";
import { emptySpace } from "../core/schema";
import type { Space, Cut } from "../core/schema";

test("renderTepBody names the docs/ paths the cut must land, for a cut that is not exempt", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "document the new retry backoff",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "docs/modules/ROOT/pages/retries.adoc describes the backoff" }],
        grounding: {
          touchpoints: [{ path: "docs/modules/ROOT/pages/retries.adoc", planned: true }],
          stamp: [],
        },
      },
    ],
  };
  const cut: Cut = { id: "cut-1", changeIds: ["n1"] };
  const body = renderTepBody(space, cut);
  assert.ok(
    body.includes("docs/modules/ROOT/pages/retries.adoc"),
    "the docs/ path the cut must land is named in the rendered TEP body",
  );
});
