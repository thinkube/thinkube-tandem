/**
 * INVARIANT — every delivery shape closeGate can build carries the run's id
 * and produced-at time: a delivery that opens, a delivery withheld because
 * the repository's suite is red after the work, and a delivery withheld
 * because a promise is not kept. Reusing the three real-run scenarios
 * delivers.test.ts already exercises, checked here for the run stamp only.
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

function stampOf(delivery: unknown): { runId?: string; producedAt?: string } {
  const d = delivery as { runId?: string; producedAt?: string };
  return { runId: d.runId, producedAt: d.producedAt };
}

test("an OPENED delivery carries the run's id and produced-at time", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-stamp-opened" };
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
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the run opened a delivery");
  const stamp = stampOf(outcome.delivery);
  assert.ok(stamp.runId?.includes(cut.tepId), `opened delivery lacks the run id: ${JSON.stringify(stamp)}`);
  assert.ok(stamp.producedAt, "opened delivery lacks the produced-at time");
});

test("a delivery WITHHELD FOR A RED SUITE carries the run's id and produced-at time", async () => {
  // The product build rejects the tree the coder ships — the same fixture
  // delivers.test.ts uses to prove a red suite withholds the delivery.
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-stamp-redsuite" };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      build: "test ! -e src/greet.mjs",
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      worker: scriptedWorker(shape, "honest", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(outcome.delivery?.withheld, "the delivery was withheld for a red suite");
  const stamp = stampOf(outcome.delivery);
  assert.ok(stamp.runId?.includes(cut.tepId), `withheld-red-suite delivery lacks the run id: ${JSON.stringify(stamp)}`);
  assert.ok(stamp.producedAt, "withheld-red-suite delivery lacks the produced-at time");
});

test("a delivery WITHHELD FOR AN UNKEPT PROMISE carries the run's id and produced-at time", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-stamp-unkept" };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(outcome.delivery?.withheld, "the delivery was withheld for an unkept promise");
  assert.match(outcome.delivery!.withheld!, /not kept/);
  const stamp = stampOf(outcome.delivery);
  assert.ok(stamp.runId?.includes(cut.tepId), `withheld-unkept delivery lacks the run id: ${JSON.stringify(stamp)}`);
  assert.ok(stamp.producedAt, "withheld-unkept delivery lacks the produced-at time");
});
