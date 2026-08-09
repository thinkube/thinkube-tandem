import { test } from "node:test";
import assert from "node:assert/strict";
import { amendAsk, editAsk, priceOfEditing } from "./reframe";
import { Space } from "./schema";

function space(): Space {
  return {
    asks: [
      { id: "ask-1", text: "the delivery page shows how to see it", at: "t" },
      { id: "ask-4", text: "proof labels name the check in my words", at: "t" },
      { id: "ask-8", text: "list the unwired engine modules", at: "t" },
    ],
    nodes: [
      { id: "n1", sentence: "a", serves: ["sub-1"], needs: [], servesClaim: "c1", acceptance: [] },
      { id: "n2", sentence: "b", serves: ["sub-1"], needs: [], servesClaim: "c2", acceptance: [] },
      { id: "n3", sentence: "c", serves: ["sub-4"], needs: [], servesClaim: "c5", acceptance: [] },
    ],
    questions: [{ id: "q1", askId: "sub-1", text: "which one?" }],
    cuts: [],
    impacts: [],
    units: [],
    deliveries: [],
    pins: [],
    subjects: [
      { id: "sub-1", name: "the delivery page", from: ["ask-1", "ask-4"] },
      { id: "sub-4", name: "ENGINE-WIRING.md", from: ["ask-8"] },
    ],
    claims: [
      { id: "c1", subjectId: "sub-1", text: "shows a see-it line", fromAsk: "ask-1" },
      { id: "c2", subjectId: "sub-1", text: "labels name the check", fromAsk: "ask-4" },
      { id: "c5", subjectId: "sub-4", text: "lists every unwired module", fromAsk: "ask-8" },
    ],
  } as Space;
}

test("the price of an edit names what is re-read, including the sentence you did not touch", () => {
  const p = priceOfEditing(space(), "ask-1");
  assert.equal(p.subjects, 1);
  assert.equal(p.promises, 2, "both promises of that object go");
  assert.deepEqual(p.alsoReads, ["proof labels name the check in my words"]);
});

test("editing an open sentence replaces its words and discards what was read from them", () => {
  const r = editAsk(space(), "ask-1", "the delivery page shows how to see each claim", new Set());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.space.asks[0].text, "the delivery page shows how to see each claim");
  assert.equal(r.space.subjects!.length, 1, "the object read from those words is gone");
  assert.deepEqual(r.space.nodes.map((n) => n.id), ["n3"], "unrelated work is untouched");
  assert.equal(r.space.questions.length, 0, "assumptions made under the old words go with them");
  assert.deepEqual(r.reread.sort(), ["ask-1", "ask-4"]);
});

test("a sentence whose work is signed refuses the edit and says what to do instead", () => {
  const r = editAsk(space(), "ask-1", "something else", new Set(["n1"]));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /already built/);
  assert.match(r.reason, /new sentence/);
});

test("an amendment is a new sentence that names the one it supersedes", () => {
  const r = amendAsk(space(), "ask-1", "and it prints the reason too", "t2", "ask-11");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.added.amends, "ask-1");
  assert.equal(r.space.asks.length, 4, "the original stays exactly as it was");
  assert.equal(r.space.asks[0].text, "the delivery page shows how to see it");
});
