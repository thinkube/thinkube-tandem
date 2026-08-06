/**
 * The cut is closed under needs: adding pulls the dependency closure in,
 * removing drops dependents, and the sign backstop names anything dangling.
 * Plus the check-proposal round's pure parts: the prompt carries the
 * promise, the parse is strict and defaults to a runnable check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { addWithNeeds, danglingNeeds, removeWithDependents } from "./cutClosure";
import { buildCheckPrompt, parseProposedCheck } from "../derive/checks";
import { Change } from "./schema";

const N = (id: string, needs: string[] = []): Change => ({
  id,
  sentence: `promise ${id}`,
  serves: ["ask-1"],
  needs,
  acceptance: [],
});

test("adding a promise pulls its transitive needs; the note says what came along", () => {
  const nodes = [N("a", ["b"]), N("b", ["c"]), N("c"), N("d")];
  const cut = new Set<string>();
  const r = addWithNeeds(cut, ["a"], nodes);
  assert.deepEqual([...cut].sort(), ["a", "b", "c"]);
  assert.ok(r.note!.includes("2"));
  assert.deepEqual(addWithNeeds(cut, ["d"], nodes), {}, "no dependencies, no note");
});

test("removing a promise drops everything that needed it", () => {
  const nodes = [N("a", ["b"]), N("b", ["c"]), N("c"), N("d")];
  const cut = new Set(["a", "b", "c", "d"]);
  const r = removeWithDependents(cut, ["c"], nodes);
  assert.deepEqual([...cut], ["d"], "a and b needed c (transitively) and left too");
  assert.ok(r.note!.includes("2"));
});

test("the sign backstop names dangling needs by sentence", () => {
  const nodes = [N("a", ["b"]), N("b")];
  const d = danglingNeeds(["a"], nodes);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].missing, ["promise b"]);
  assert.equal(danglingNeeds(["a", "b"], nodes).length, 0, "closed cut is clean");
});

test("check proposal: prompt carries the promise; parse is strict", () => {
  const p = buildCheckPrompt(N("a"), "the ask text");
  assert.ok(p.includes("promise a") && p.includes("the ask text"));
  assert.deepEqual(parseProposedCheck('x {"text":"the page shows y","kind":"assessment"} z'), {
    text: "the page shows y",
    kind: "assessment",
  });
  assert.equal(parseProposedCheck('{"kind":"probe"}'), undefined);
  assert.equal(parseProposedCheck(null), undefined);
  assert.equal(parseProposedCheck("no json")?.kind, undefined);
});

test("A6: signed promises refuse re-cutting — in the basket AND at the gate", () => {
  const nodes = [N("a"), N("b")];
  const signed = new Set(["a"]);
  const cut = new Set<string>();
  const r = addWithNeeds(cut, ["a", "b"], nodes, signed);
  assert.deepEqual([...cut], ["b"], "the signed promise never enters");
  assert.ok(r.note!.includes("signed work order"));
});
