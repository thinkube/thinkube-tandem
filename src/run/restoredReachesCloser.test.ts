/**
 * What the guard takes back is not lost with it.
 *
 * A revert is sometimes right — a coder must never write the checks that
 * judge it — but it undoes two things and only one is meant: the change,
 * and what the unit worked out making it. The actor that comes last is
 * fenced by nothing and reaches the same files, so it had to rediscover in
 * an empty tree what a fenced unit had already found and written.
 *
 * That is not hypothetical. One unit worked out that `doorsBySentence`
 * needed a second argument and that `deliveryPage.ts` had to pass it,
 * wrote exactly that, was restored, and was failed on its next attempt.
 * The run kept the failure and threw away the answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closerBrief } from "./closer";

const PATCH = `--- a/src/surfaces/deliveryPage.ts
+++ b/src/surfaces/deliveryPage.ts
-  const doors = doorsBySentence(s.space.nodes);
+  const doors = doorsBySentence(s.space.nodes, surfaceText);`;

function brief(restored?: { path: string; patch: string }[]): string {
  return closerBrief({
    subject: "TEP-1 (the unkept promises)",
    worktree: "/wt",
    footprint: ["src/run/gate.ts"],
    probeSources: [],
    history: ["a promise: still red"],
    criteria: [{ id: "c1", text: "the page names every criterion" }],
    state: { evidence: "1 red", green: false, score: 4 },
    ...(restored ? { restored } : {}),
  } as never);
}

test("the closer is shown the work a fenced unit wrote and lost", () => {
  const b = brief([{ path: "src/surfaces/deliveryPage.ts", patch: PATCH }]);
  assert.match(b, /WORK A FENCED UNIT WROTE AND THE GUARD TOOK BACK/);
  assert.match(b, /src\/surfaces\/deliveryPage\.ts/);
  assert.match(b, /doorsBySentence\(s\.space\.nodes, surfaceText\)/, "the change itself, not a summary of it");
});

test("it is offered as evidence, never as an instruction", () => {
  const b = brief([{ path: "src/surfaces/deliveryPage.ts", patch: PATCH }]);
  assert.match(b, /what it wrote, not what you must write/, "the closer judges it — the fenced unit was not the authority");
  assert.match(b, /You are fenced by nothing/, "and it is told it may act where the other could not");
});

test("a run where the guard took nothing back says nothing about it", () => {
  const b = brief();
  assert.doesNotMatch(b, /TOOK BACK/, "no empty heading for a thing that did not happen");
});
