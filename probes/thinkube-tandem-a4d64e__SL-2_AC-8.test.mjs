// AC-8 (INVARIANT): tepContentHash differs across a waived cut, an
// unwaived cut, and a cut waived with a different reason — the approval
// token must be bound to the documentation decision, not just the promises.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { addAsk, addNode } = require("../out/core/intent.js");
const { tepContentHash } = require("../out/gates/approval.js");

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "add a keyboard shortcut for search", "t");
  s = a.space;
  const r = addNode(s, {
    sentence: "pressing / focuses the search box",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "/ focuses search" }],
    grounding: { touchpoints: [{ path: "src/search/shortcut.ts" }], stamp: [] },
  });
  s = r.space;
  return { space: s, changeIds: [r.added.id] };
}

test("tepContentHash differs between no waiver, a waiver, and a differently-reasoned waiver", () => {
  const { space, changeIds } = makeSpace();

  const noWaiver = tepContentHash(space, { changeIds });
  const waivedA = tepContentHash(space, { changeIds, docs: { waived: true, reason: "no docs page exists for shortcuts" } });
  const waivedB = tepContentHash(space, { changeIds, docs: { waived: true, reason: "internal only, not published" } });

  assert.notEqual(noWaiver, waivedA, "recording a waiver changes the content hash");
  assert.notEqual(noWaiver, waivedB, "recording any waiver changes the content hash");
  assert.notEqual(waivedA, waivedB, "a differently-reasoned waiver produces a different hash");
});
