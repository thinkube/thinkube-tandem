/**
 * TRANSITION — the run state a person watches while a run is in flight does
 * not yet name itself with the run id the delivery will carry. This proves
 * a run driven with a scripted worker exposes, on the state the surface
 * reads (RunState.view(), what spacePush forwards as `run`), the SAME run
 * id that lands on the delivery it mints — so the identity on the report
 * can be matched against the run just watched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchTep } from "../run/dispatch";
import { RunState } from "../run/state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "../run/shapes";
import type { RepoShape } from "../run/shapes";

function oneAsk() {
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

test("the run state the surface reads names itself with the same run id the delivery it mints will carry", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-watch" };
  const state = new RunState(() => {});

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state,
      supervisorRound: async () => null,
      spaceName: "watch",
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "watch" }),
  );
  assert.ok(outcome.delivery, "the run reached a delivery");
  const delivery = outcome.delivery as unknown as { runId?: string };
  assert.ok(delivery.runId, "the delivery carries a run id");

  const view = state.view() as unknown as { runId?: string };
  assert.equal(
    view.runId,
    delivery.runId,
    "the state the surface reads names itself with the same run id that lands on the delivery",
  );
});
