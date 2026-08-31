/**
 * TRANSITION — closeGate must file its own lines under the step named
 * "gate" (the same name its card carries) instead of the run-wide default,
 * so pressing the gate card's log chip shows the account of what the gate
 * itself did, including its opening line — not an empty panel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import {addAsk} from "../core/intent";

import { SHAPES, repoInShape, scriptedWorker , addNode} from "./shapes";
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

test("after a dispatch that reaches the closing gate, the 'gate' step log holds the gate's own opening line", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-gate-log" };
  const state = new RunState(() => {});

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state,
      supervisorRound: async () => null,
      spaceName: "delivers",
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );

  assert.ok(outcome.delivery, "the dispatch reached the closing gate and a delivery");
  const gateLog = state.logTail("gate").lines;
  assert.ok(gateLog.length > 0, "the 'gate' step log holds at least one line");
  assert.ok(
    gateLog.some((l) => /closing gate/.test(l)),
    `the gate's own opening line is among them: ${gateLog.slice(0, 3).join(" | ")}`,
  );
});
