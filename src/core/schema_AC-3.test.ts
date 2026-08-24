/**
 * TRANSITION — a withheld delivery does not yet carry the run's id or its
 * producedAt. This proves that when the repository suite is red and the
 * delivery is withheld, the run's identity and its moment still ride the
 * withheld delivery — a withheld report must be traceable to its run just
 * like an opened one.
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

test("a withheld delivery still carries the run's id and its producedAt", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-withheld-clock" };
  const FIXED_AT = "2026-08-24T10:30:00.000Z";
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "withheld-clock",
      now: () => FIXED_AT,
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "withheld-clock" }),
  );

  assert.ok(outcome.delivery, "the run still reaches a terminal delivery");
  assert.ok(outcome.delivery?.withheld, "and it is withheld");
  const delivery = outcome.delivery as unknown as { runId?: string; producedAt?: string };
  assert.ok(delivery.runId, "the withheld delivery carries the run's id");
  assert.match(delivery.runId!, /TEP-withheld-clock/, "naming the TEP it ran");
  assert.equal(
    delivery.producedAt,
    FIXED_AT,
    "and the moment it was produced, from the injected clock",
  );
});
