// AC-2 (INVARIANT): the cut review page of a waived cut states that
// documentation is not needed AND quotes the human's reason — a waiver is
// meaningless on the page if its reason is not shown beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { addAsk, addNode } = require("../out/core/intent.js");
const { renderCutScreen } = require("../out/gates/render.js");

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "add a debug-only tracing flag", "t");
  assert.ok(a.ok);
  s = a.space;
  const r = addNode(s, {
    sentence: "a hidden env flag turns on verbose tracing",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "tracing lines appear when the flag is set" }],
    grounding: { touchpoints: [{ path: "src/debug/trace.ts" }], stamp: [] },
  });
  assert.ok(r.ok);
  s = r.space;
  return { space: s, changeIds: [r.added.id] };
}

test("waived cut's review page states documentation is not needed and quotes the reason", () => {
  const { space, changeIds } = makeSpace();
  const reason = "internal debug flag — never documented for end users";
  const screen = renderCutScreen(space, {
    id: "cut-1",
    changeIds,
    docs: { waived: true, reason },
  });
  assert.match(
    screen,
    /documentation.*not needed/i,
    "a waived cut's review page names documentation as not needed",
  );
  assert.ok(
    screen.includes(reason),
    "the human's own reason is quoted on the page, not summarized or dropped",
  );
});
