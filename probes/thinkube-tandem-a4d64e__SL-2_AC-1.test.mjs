// AC-1 (INVARIANT): the cut review page of an undecided cut states the
// documentation decision on its face — a line saying documentation is
// required — because the human must be able to see the obligation without
// hunting for it elsewhere on the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { addAsk, addNode } = require("../out/core/intent.js");
const { renderCutScreen } = require("../out/gates/render.js");

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "write the release notes generator", "t");
  assert.ok(a.ok);
  s = a.space;
  const r = addNode(s, {
    sentence: "the generator writes a changelog entry per release",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "a changelog entry is written" }],
    grounding: { touchpoints: [{ path: "src/release/notes.ts" }], stamp: [] },
  });
  assert.ok(r.ok);
  s = r.space;
  return { space: s, changeIds: [r.added.id] };
}

test("undecided cut's review page states documentation is required", () => {
  const { space, changeIds } = makeSpace();
  // No documentation decision has been recorded on this cut — the default
  // is "required", and the review page must say so plainly.
  const screen = renderCutScreen(space, { id: "cut-1", changeIds });
  assert.match(
    screen,
    /documentation.*required/i,
    "an undecided cut's review page names documentation as required",
  );
});
