/**
 * TRANSITION — a delivery returned by dispatchTep does not yet carry the
 * run's own id or the moment it was produced. This proves that once the
 * run finishes, its delivery names the run's id and a producedAt equal to
 * the value the injected clock returned — from the run's own identity, not
 * guessed from the branch or the tep alone.
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

test("a delivery from dispatchTep carries the run's id and a producedAt from the injected clock", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-clock-1" };
  const FIXED_AT = "2026-08-24T10:00:00.000Z";
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "clock",
      now: () => FIXED_AT,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "clock" }),
  );

  assert.ok(outcome.delivery, "the run reached a delivery");
  assert.equal(outcome.delivery?.withheld, undefined, `withheld: ${outcome.delivery?.withheld}`);
  const delivery = outcome.delivery as unknown as { runId?: string; producedAt?: string };
  assert.ok(delivery.runId, "the delivery carries the run's id");
  assert.match(delivery.runId!, /TEP-clock-1/, "the run's id names the TEP it ran");
  assert.equal(
    delivery.producedAt,
    FIXED_AT,
    "producedAt is the value the injected clock returned, not a fresh read of the wall clock",
  );
});

/** Drive one whole run of the same cut at a scripted moment. */
async function runAt(at: string): Promise<{ runId: string; producedAt: string }> {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-clock-twice" };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "clock-twice",
      now: () => at,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "clock-twice" }),
  );
  assert.ok(outcome.delivery, "the run reached a delivery");
  const d = outcome.delivery as unknown as { runId?: string; producedAt?: string };
  assert.ok(d.runId, "the delivery carries a run id");
  assert.ok(d.producedAt, "the delivery carries a produced-at moment");
  return { runId: d.runId!, producedAt: d.producedAt! };
}

test("the same run driven twice with two scripted moments yields two run ids and two moments", async () => {
  const AT_ONE = "2026-08-24T10:00:00.000Z";
  const AT_TWO = "2026-08-24T16:20:00.000Z";

  const first = await runAt(AT_ONE);
  const second = await runAt(AT_TWO);

  assert.equal(first.producedAt, AT_ONE, "the first run's moment comes from its own clock");
  assert.equal(second.producedAt, AT_TWO, "the second run's moment comes from its own clock");
  assert.notEqual(
    first.producedAt,
    second.producedAt,
    "two runs at two moments produce two produced-at times",
  );
  // Identity must be minted per run, not derived from the cut alone —
  // otherwise a re-run's delivery cannot be told from the one it replaces.
  assert.notEqual(first.runId, second.runId, "two runs of the same cut mint two different run ids");
});
