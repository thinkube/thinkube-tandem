/**
 * A person says a delivered promise does not hold, and the work comes
 * back — no delivery un-accepted, no history edited.
 *
 * In half of this platform's targets no machine speaks after the merge:
 * an editor extension, a template, an installer. The person's word is the
 * only word there is, and it did nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { builtIds, contradicted, unkeptPromises } from "../core/contradiction";
import { emptySpace } from "../core/schema";

function session(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-hold-"));
  const s = new TandemSession({
    author: "cmxela",
    round: { model: "m", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  } as never);
  s.space = {
    ...emptySpace(),
    asks: [{ id: "a1", text: "deleting a task asks me first" }],
    subjects: [{ id: "s1", name: "deleting a task", from: ["a1"] }],
    claims: [{ id: "c1", subjectId: "s1", text: "it asks first", fromAsk: "a1" }],
    nodes: [
      {
        id: "n1",
        sentence: "Deleting a task asks in the page before it goes.",
        serves: ["a1", "s1"],
        servesClaim: "c1",
        acceptance: [
          { id: "k1", text: "a question names the task", kind: "probe" },
          { id: "k2", text: "backing out keeps the task", kind: "probe" },
        ],
        needs: [],
      },
    ],
    cuts: [{ id: "cut-1", tepId: "TEP-1", changeIds: ["n1"], askIds: ["a1"], signature: "sig", specId: "spec-1" }],
    specs: [{ id: "spec-1", name: "I never delete a task by accident", subjectIds: ["s1"] }],
    deliveries: [
      {
        id: "delivery-TEP-1",
        cutId: "cut-1",
        branch: "b",
        producedAt: "2026-01-01T00:00:00.000Z",
        acceptedAt: "2026-01-01T01:00:00.000Z",
        proofs: [
          { kind: "probe", label: "a question names the task", verdict: "green", criterionId: "k1" },
          { kind: "probe", label: "backing out keeps the task", verdict: "green", criterionId: "k2" },
        ],
      },
    ],
  } as never;
  return s;
}

test("a delivered promise the person refuses is not built any more, at the criterion it names", () => {
  const s = session();
  assert.deepEqual([...builtIds(s.space)], ["n1"], "delivered and accepted: built");

  assert.deepEqual(s.contradict({ criterionId: "k2" }, "backing out deleted the task anyway"), { ok: true });
  assert.deepEqual([...contradicted(s.space).keys()], ["k2"], "the criterion it was said about, and no other");
  assert.deepEqual([...unkeptPromises(s.space).keys()], ["n1"]);
  assert.deepEqual([...builtIds(s.space)], [], "its promise is work again");

  // History stands: the delivery is still accepted, its proofs untouched.
  const d = s.space.deliveries[0];
  assert.ok(d.acceptedAt);
  assert.deepEqual(d.proofs.map((p) => p.verdict), ["green", "green"]);
});

test("the whole promise can be refused when the person cannot say which criterion", () => {
  const s = session();
  assert.deepEqual(s.contradict({ promiseId: "n1" }, "the question never appears"), { ok: true });
  assert.deepEqual([...contradicted(s.space).keys()].sort(), ["k1", "k2"]);
});

test("without words it is refused, and nothing is recorded", () => {
  const s = session();
  const r = s.contradict({ criterionId: "k1" }, "   ");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /say what you saw/);
  assert.equal(s.space.contradictions, undefined);
});

test("work nobody delivered cannot be contradicted — it is already waiting to be built", () => {
  const s = session();
  s.space = { ...s.space, deliveries: [] };
  const r = s.contradict({ promiseId: "n1" }, "it does not work");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /already waiting to be built/);
});

test("a later delivery that proves it green again answers the contradiction", () => {
  const s = session();
  s.contradict({ criterionId: "k2" }, "backing out deleted the task anyway");
  assert.equal(contradicted(s.space).size, 1);
  s.space = {
    ...s.space,
    deliveries: [
      ...s.space.deliveries,
      {
        id: "delivery-TEP-2",
        cutId: "cut-2",
        branch: "b2",
        producedAt: new Date(Date.now() + 60_000).toISOString(),
        proofs: [{ kind: "probe", label: "backing out keeps the task", verdict: "green", criterionId: "k2" }],
      },
    ] as never,
  };
  assert.equal(contradicted(s.space).size, 0, "the newest evidence is the proof, so nothing is removed to clear it");
  assert.deepEqual([...builtIds(s.space)], ["n1"]);
});
