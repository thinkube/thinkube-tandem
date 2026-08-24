/**
 * INVARIANT — a real run, driven end to end with a scripted worker exactly
 * as delivers.test.ts drives one, returns a delivery whose runId and
 * producedAt name the run that produced it — not a generic marker, but the
 * concrete stamp minted for this run.
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

test("a real run's delivery carries that run's own id and produced-at time", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-runstamp-delivery" };
  const before = Date.now();
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  const after = Date.now();

  assert.ok(outcome.delivery, "the run reached a delivery");
  assert.equal(outcome.delivery?.withheld, undefined, `the delivery was withheld: ${outcome.delivery?.withheld}`);

  const runId = (outcome.delivery as unknown as { runId?: string }).runId;
  const producedAt = (outcome.delivery as unknown as { producedAt?: string }).producedAt;

  assert.ok(runId, "the delivery names the run that produced it");
  assert.ok(runId!.includes(cut.tepId), `run id does not carry the TEP: ${runId}`);
  assert.ok(producedAt, "the delivery names when it was produced");
  const producedMs = Date.parse(producedAt!);
  assert.ok(
    producedMs >= before && producedMs <= after,
    `produced-at (${producedAt}) is not within the run's own wall-clock window [${before}, ${after}]`,
  );
});
