/**
 * TRANSITION — renderCutScreen used to say nothing about documentation.
 * This pins the first duty: a cut whose sole member grounds one docs/ path
 * must print a Documentation line naming that path, so a signer sees the
 * pages this cut will write before they sign.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen prints a Documentation line naming the one docs/ path a member grounds", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "document the greet module",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: {
          touchpoints: [{ path: "docs/modules/ROOT/pages/greet.adoc", planned: true }],
          stamp: [],
        },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1"] } as never);
  assert.match(screen, /Documentation/, "a Documentation line is printed");
  assert.match(
    screen,
    /docs\/modules\/ROOT\/pages\/greet\.adoc/,
    "the line names the docs/ path the cut will write",
  );
});
