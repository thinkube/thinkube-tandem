import { test } from "node:test";
import assert from "node:assert/strict";
import { askState, componentOf, components, promisesOf } from "./component";
import { Space } from "./schema";

/** The shape of the real round-1 space: one object read from two
 *  sentences, one sentence read as two objects, and independent rest. */
function space(): Space {
  return {
    asks: [
      { id: "ask-1", text: "the delivery page shows how to see it", at: "t" },
      { id: "ask-2", text: "documentation is required unless I say otherwise", at: "t" },
      { id: "ask-4", text: "proof labels name the check in my words", at: "t" },
      { id: "ask-8", text: "list the unwired engine modules", at: "t" },
    ],
    nodes: [
      { id: "n1", sentence: "a", serves: ["sub-1"], needs: [], servesClaim: "c1", acceptance: [] },
      { id: "n2", sentence: "b", serves: ["sub-3"], needs: [], servesClaim: "c4", acceptance: [] },
    ],
    questions: [],
    cuts: [],
    impacts: [],
    units: [],
    deliveries: [],
    pins: [],
    subjects: [
      { id: "sub-1", name: "the delivery page", from: ["ask-1", "ask-4"] },
      { id: "sub-2", name: "the cut review page", from: ["ask-2"] },
      { id: "sub-3", name: "the TEP", from: ["ask-2"] },
      { id: "sub-4", name: "ENGINE-WIRING.md", from: ["ask-8"] },
    ],
    claims: [
      { id: "c1", subjectId: "sub-1", text: "shows a see-it line", fromAsk: "ask-1" },
      { id: "c2", subjectId: "sub-1", text: "labels name the check", fromAsk: "ask-4" },
      { id: "c3", subjectId: "sub-2", text: "I can say docs are not needed", fromAsk: "ask-2" },
      { id: "c4", subjectId: "sub-3", text: "the reason is recorded in it", fromAsk: "ask-2" },
      { id: "c5", subjectId: "sub-4", text: "it lists every unwired module", fromAsk: "ask-8" },
    ],
  } as Space;
}

test("two sentences about one object are one component; one sentence about two objects too", () => {
  const all = components(space());
  const shapes = all
    .map((c) => `${[...c.askIds].sort().join("+")} :: ${[...c.subjectIds].sort().join("+")}`)
    .sort();
  assert.deepEqual(shapes, [
    "ask-1+ask-4 :: sub-1",
    "ask-2 :: sub-2+sub-3",
    "ask-8 :: sub-4",
  ]);
});

test("a component carries every promise derived for its objects", () => {
  const sp = space();
  const c = componentOf(sp, "ask-2")!;
  assert.deepEqual(promisesOf(sp, c), ["n2"], "the TEP's promise ships with the cut page's");
});

test("a signature binds every sentence in the component, and no other", () => {
  const sp = space();
  const signed = new Set(["n2"]);
  assert.equal(askState(sp, "ask-2", signed), "bound", "its own sentence is bound");
  assert.equal(askState(sp, "ask-1", signed), "open", "an unrelated sentence stays free");
  assert.equal(askState(sp, "ask-4", signed), "open");
});

test("binding one sentence binds the sentence that shares its object", () => {
  const sp = space();
  const signed = new Set(["n1"]);
  assert.equal(askState(sp, "ask-1", signed), "bound");
  assert.equal(
    askState(sp, "ask-4", signed),
    "bound",
    "it describes the same object, so its words are part of what was signed",
  );
});

test("a sentence with nothing derived yet is open and stands alone", () => {
  const sp = space();
  sp.asks.push({ id: "ask-9", text: "spaces open in their own tab", at: "t" });
  assert.equal(askState(sp, "ask-9", new Set(["n1", "n2"])), "open");
  assert.deepEqual(componentOf(sp, "ask-9"), { askIds: ["ask-9"], subjectIds: [] });
});
