/**
 * INVARIANT — moving the gate's own lines to step "gate" must not flatten
 * the closer's lines into it: the closer, run at the gate to repair an
 * unkept promise, must keep filing under its own sub-step name
 * "gate#closer", distinct from "gate" itself.
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

test('the closer\'s lines stay under "gate#closer", not flattened into "gate"', async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-gate-closer" };
  const state = new RunState(() => {});

  // "unchanging" leaves the coder's own work failing the check. The third
  // argument, closerFixes: false, stops the UNIT-level closer from repairing
  // the tree first — with it left on, the unit closer succeeds, the gate has
  // no unkept promise left to repair, and the gate closer never runs at all.
  // The repository's own standing tests reach the gate the same way
  // (delivers.test.ts, ends.test.ts). The delivery is withheld here, which is
  // correct and beside the point: what is under test is which step each line
  // is filed under, not whether the promise was finally kept.
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state,
      supervisorRound: async () => null,
      spaceName: "gate-closer",
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "gate-closer" }),
  );

  assert.ok(outcome.delivery, "the run reached a delivery, and the gate closer ran");
  assert.ok(
    (state.stepLogs.get("gate#closer") ?? []).length > 0,
    "the closer wrote at least one line of its own",
  );
  assert.ok(
    (state.stepLogs.get("gate") ?? []).length > 0,
    "the gate itself also wrote its own lines",
  );
  // Neither is folded into the other in the raw storage.
  const closerLines = new Set(state.stepLogs.get("gate#closer") ?? []);
  const gateLines = state.stepLogs.get("gate") ?? [];
  assert.ok(
    gateLines.every((l) => !closerLines.has(l)),
    "the closer's own lines are stored under its own sub-step, not duplicated verbatim under \"gate\"",
  );
});
