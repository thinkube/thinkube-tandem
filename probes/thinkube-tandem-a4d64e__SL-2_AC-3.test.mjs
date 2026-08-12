// AC-3 (INVARIANT): both the required-docs page and the waived-docs page
// stay within RENDER_LINE_BUDGET — the documentation line is one more fact
// on the decision surface, and adding it must never turn the page into
// homework.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { addAsk, addNode } = require("../out/core/intent.js");
const { RENDER_LINE_BUDGET, renderCutScreen, renderWeight } = require("../out/gates/render.js");

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "add a status widget to the dashboard", "t");
  assert.ok(a.ok);
  s = a.space;
  const r = addNode(s, {
    sentence: "the dashboard shows a live status widget",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the widget renders live status" }],
    grounding: { touchpoints: [{ path: "src/dashboard/status.ts" }], stamp: [] },
  });
  assert.ok(r.ok);
  s = r.space;
  return { space: s, changeIds: [r.added.id] };
}

test("both the required-docs and waived-docs cut screens fit RENDER_LINE_BUDGET", () => {
  const { space, changeIds } = makeSpace();

  const requiredScreen = renderCutScreen(space, { id: "cut-1", changeIds });
  assert.ok(
    renderWeight(requiredScreen) <= RENDER_LINE_BUDGET,
    `undecided-docs page is decision-sized: ${renderWeight(requiredScreen)} lines`,
  );

  const waivedScreen = renderCutScreen(space, {
    id: "cut-2",
    changeIds,
    docs: { waived: true, reason: "no user-facing behaviour to document" },
  });
  assert.ok(
    renderWeight(waivedScreen) <= RENDER_LINE_BUDGET,
    `waived-docs page is decision-sized: ${renderWeight(waivedScreen)} lines`,
  );
});
