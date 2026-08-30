/**
 * TRANSITION — logTail("gate") must return the gate's own lines followed by
 * the closer's, so a single click on the gate card's log chip shows the
 * whole account: why the gate acted, and what the closer did about it —
 * not just the gate's own half of the story.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "./shapes";
import type { RepoShape } from "./shapes";

function oneAsk(): { space: ReturnType<typeof emptySpace>; ids: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, ids: [n.added.id] };
}

test('logTail("gate") shows the gate\'s own lines followed by the closer\'s', async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-gate-tail" };
  const state = new RunState(() => {});

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state,
      supervisorRound: async () => null,
      spaceName: "gate-tail",
      // closerFixes: false stops the UNIT-level closer from repairing the
      // tree first — otherwise the gate has no unkept promise left and its
      // own closer never runs, leaving "gate#closer" legitimately empty.
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "gate-tail" }),
  );

  assert.ok(outcome.delivery, "the run reached a delivery, and the gate closer ran");

  const ownLines = state.stepLogs.get("gate") ?? [];
  const closerLines = state.stepLogs.get("gate#closer") ?? [];
  assert.ok(ownLines.length > 0, "the gate wrote its own lines");
  assert.ok(closerLines.length > 0, "the closer wrote lines too");

  const { lines: tail } = state.logTail("gate");
  assert.deepEqual(
    tail,
    [...ownLines, ...closerLines],
    "one click on the gate card must show the gate's own account followed by the closer's",
  );
});
