/**
 * TRANSITION — a withheld delivery (the repository's suite red after the
 * work) does not yet carry a run identity. This proves it now carries the
 * same run id and produced-at stamp a delivered one would, minted from the
 * same run.
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

test("a withheld delivery (suite red after the work) carries a run id and produced-at, same shape as a delivered one", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-withheldstamp" };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      // The repository's own suite fails after the work — the delivery is withheld.
      suiteCommand: ["node", "-e", "process.exit(1)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "withheldstamp",
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "withheldstamp" }),
  );
  assert.ok(outcome.delivery, "the run still reaches a terminal delivery");
  assert.ok(outcome.delivery?.withheld, "and it is withheld, not opened");
  const withheldDelivery = outcome.delivery as unknown as { runId?: string; producedAt?: string };
  assert.ok(withheldDelivery.runId, "a withheld delivery carries the run id of the run that produced it");
  assert.ok(withheldDelivery.producedAt, "a withheld delivery carries the produced-at moment of the run that produced it");
});
