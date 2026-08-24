/**
 * INVARIANT — the new Documentation line is one line (or one small block)
 * added to the existing cut review, not a rewrite of it: sections the
 * screen already prints (where a promise lands, what is not grounded)
 * still appear once the Documentation line is added, so an unrelated
 * change to the docs duty cannot silently drop context a signer relied on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen's existing sections still print once the Documentation line is added", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the panel opens once per space",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "opening twice reveals the same tab" }],
        grounding: { touchpoints: [{ path: "docs/panel.adoc", planned: false, scope: "web" }], stamp: [] },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1"] } as never);
  assert.match(screen, /in web/, "the repository each promise lands in is still on the page");
  assert.match(screen, /Documentation/, "the Documentation line is also present");
  assert.match(screen, /docs\/panel\.adoc/, "naming the docs/ path the cut will write");
  // The Documentation duty is reported exactly once per cut screen — not
  // once per member — so a multi-line block does not repeat the heading.
  const headingCount = (screen.match(/Documentation/g) ?? []).length;
  assert.equal(headingCount, 1, `expected exactly one Documentation heading, found ${headingCount}`);
});
