// WHY (INVARIANT): the render half of the minted hash must be exactly the
// cut screen text INCLUDING its documentation line — the same text the
// human read at the moment they clicked Sign, never a version missing the
// docs stance.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { tepContentHash } from "../src/gates/approval.ts";
import { renderCutScreen } from "../src/gates/render.ts";

test("the hash's render half matches the actual cut screen text, docs line included", () => {
  let s = emptySpace();
  const a = addAsk(s, "add an undocumented thing", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a promise nowhere documented",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  assert.ok(n.ok);
  s = n.space;

  const cut = {
    changeIds: [n.added.id],
    tepId: "TEP-t-1",
    docs: { waived: true, reason: "internal-only, no user surface" },
  };

  const screen = renderCutScreen(s, { id: "pair", changeIds: cut.changeIds, docs: cut.docs });
  assert.match(screen.toLowerCase(), /documentation|docs/, "the rendered screen carries a documentation line");

  // Changing ONLY the docs stance (not any grounded member) must move the
  // render half and therefore the overall hash — proving the hash is bound
  // to the render the human actually saw, not a docs-blind subset of it.
  const hashA = tepContentHash(s, cut);
  const differentReason = { ...cut, docs: { waived: true, reason: "a completely different reason" } };
  const hashB = tepContentHash(s, differentReason);
  assert.notEqual(hashA, hashB, "a changed documentation line changes the bound hash");
});
