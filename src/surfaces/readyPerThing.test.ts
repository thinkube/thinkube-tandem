/**
 * With a thing in hand, the price and the readiness are that thing's alone.
 *
 * The cost of thinking counted every subject in the space, so once the
 * chosen thing was worked out the strip offered to work out the others
 * under its name, and Build waited for subjects nobody was building.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { costOfThinking, readyToBuild } from "./buildFlow";
import { emptySpace, Space } from "../core/schema";

function space(): Space {
  return {
    ...emptySpace(),
    asks: [
      { id: "a1", text: "one", at: "" },
      { id: "a2", text: "two", at: "" },
    ] as Space["asks"],
    subjects: [
      { id: "subject-1", name: "the list", from: ["a1"] },
      { id: "subject-2", name: "the box", from: ["a2"] },
    ],
    claims: [
      { id: "c1", subjectId: "subject-1", text: "sorted", fromAsk: "a1" },
      { id: "c2", subjectId: "subject-2", text: "focused", fromAsk: "a2" },
    ],
    // Only the list has been worked out: one promise serves it.
    nodes: [
      { id: "n1", sentence: "the list comes back sorted", serves: ["subject-1"], servesClaim: "c1", needs: [], acceptance: [] },
    ] as unknown as Space["nodes"],
    specs: [
      { id: "s1", name: "see what to do", subjectIds: ["subject-1"] },
      { id: "s2", name: "add without the mouse", subjectIds: ["subject-2"] },
    ],
  };
}

test("the price is the chosen thing's, not the space's", () => {
  const sp = space();
  assert.equal(costOfThinking(sp).subjects, 1, "space-wide, the box is still to think about");
  assert.equal(costOfThinking(sp, ["subject-1"]).subjects, 0, "the list in hand: nothing left to think about");
  assert.equal(costOfThinking(sp, ["subject-2"]).subjects, 1);
});

test("a worked-out thing is ready to build while another is not", () => {
  const sp = space();
  const chosen = sp.specs![0];
  const r = readyToBuild(sp, false, chosen);
  assert.equal(r.thinking, false);
  assert.equal(r.promises, 1);
  assert.equal(r.asks, 1, "the one sentence it locks");
  assert.equal(readyToBuild(sp, false).thinking, true, "space-wide, the box still blocks");
});

test("the act of building judges the chosen thing alone", async () => {
  const { buildFlow } = await import("./buildFlow");
  const sp = space();
  const fake = {
    space: sp,
    activity: undefined,
    groundingView: () => [],
    deps: { now: () => "2026-01-01T00:00:00.000Z" },
  } as never;
  // With the list in hand and worked out, the box being unthought is no reason.
  const r = await buildFlow(fake, "s1").catch((e: Error) => ({ ok: false, reason: e.message }));
  assert.doesNotMatch(r.reason ?? "", /still working out/, `refused for the wrong reason: ${r.reason}`);
  // The box itself, not worked out, is refused by its own name.
  const r2 = await buildFlow(fake, "s2").catch((e: Error) => ({ ok: false, reason: e.message }));
  assert.match(r2.reason ?? "", /still working out "add without the mouse"/);
});
