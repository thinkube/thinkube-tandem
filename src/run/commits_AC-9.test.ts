/**
 * TRANSITION — the closing gate must stop writing its own lines under the
 * step "gate#closer": that sub-step name is the closer's alone. The gate's
 * opening line and its own reasoning belong under "gate" itself, so the
 * surface's single log chip for the gate reads as the gate's account, not
 * a name that used to carry both.
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

test("closeGate's own opening line never lands under step 'gate#closer'", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-gate-not-closer" };
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
  const closerOnly = (state.stepLogs.get("gate#closer") ?? []).filter((l) => /closing gate/.test(l));
  assert.deepEqual(
    closerOnly,
    [],
    "the gate's own opening line is not among 'gate#closer's lines — that step is the closer's alone",
  );
});
