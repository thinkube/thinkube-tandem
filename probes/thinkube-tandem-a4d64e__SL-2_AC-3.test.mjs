// WHY (TRANSITION): the cut review page must state the documentation
// obligation on its face — before this change the page said nothing about
// documentation at all. Proves the exact required line appears once the
// page gains the ability to say it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out/core/schema.js";
import { addAsk, addNode } from "../out/core/intent.js";
import { renderCutScreen } from "../out/gates/render.js";

test("a pending cut with no documentation member and no waiver states the obligation", () => {
  let s = emptySpace();
  const a = addAsk(s, "ship the widget", "t");
  assert.ok(a.ok);
  s = a.space;
  const r = addNode(s, {
    sentence: "the widget renders",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "renders" }],
    grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
  });
  assert.ok(r.ok);
  s = r.space;

  const cut = { id: "cut-1", changeIds: [r.added.id] };
  const screen = renderCutScreen(s, cut);
  assert.ok(
    screen.includes("Documentation required — not yet in this cut."),
    `expected the fixed obligation line, got:\n${screen}`,
  );
});
