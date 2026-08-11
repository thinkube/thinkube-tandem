// TRANSITION: signCut now refuses a cut carrying a promise with no
// documentation touchpoint UNLESS the cut holds an explicit not-needed
// reason — pinning the new default-required, waiver-by-reason rule so the
// old grounding-derived docs obligation cannot silently return.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space, Cut } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { signCut } from "../src/gates/sign.ts";

function baseSpace(touchpoint: string): { space: Space; changeIds: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "ship the widget", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a widget module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "widget() returns true" }],
    grounding: { touchpoints: [{ path: touchpoint }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, changeIds: [n.added.id] };
}

test("a cut whose promises land nowhere in documentation is refused, naming the missing docs and the waiver escape", () => {
  const { space, changeIds } = baseSpace("src/widget.ts");
  const r = signCut(space, { id: "cut-1", changeIds }, "t");
  assert.equal(r.ok, false, "no docs touchpoint and no waiver — refused");
  assert.match(
    r.reason.toLowerCase(),
    /doc/,
    "the refusal names documentation as the missing thing",
  );
  assert.match(
    r.reason.toLowerCase(),
    /waiv|reason|not needed/,
    "the refusal says a reason can waive it",
  );
});

test("that same cut signs once it carries an explicit not-needed reason", () => {
  const { space, changeIds } = baseSpace("src/widget.ts");
  const cut: Cut = {
    id: "cut-1",
    changeIds,
    docs: { waived: true, reason: "internal-only helper, no user-facing surface" },
  };
  const r = signCut(space, cut, "t");
  assert.equal(r.ok, true, "an explicit waiver reason lifts the refusal");
});

test("a cut holding a promise grounded on a documentation path signs with no reason given", () => {
  const { space, changeIds } = baseSpace("docs/modules/ROOT/pages/widget.adoc");
  const r = signCut(space, { id: "cut-1", changeIds }, "t");
  assert.equal(r.ok, true, "a docs/ touchpoint satisfies the obligation on its own");
});

test("an empty or whitespace-only reason does not count as a waiver — the cut is still refused", () => {
  const { space, changeIds } = baseSpace("src/widget.ts");
  const empty: Cut = { id: "cut-1", changeIds, docs: { waived: true, reason: "" } };
  assert.equal(signCut(space, empty, "t").ok, false, "an empty reason is not a waiver");
  const blank: Cut = { id: "cut-2", changeIds, docs: { waived: true, reason: "   " } };
  assert.equal(signCut(space, blank, "t").ok, false, "a whitespace-only reason is not a waiver");
});
