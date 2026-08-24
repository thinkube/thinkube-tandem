/**
 * INVARIANT — a run driven with a stand-in forge that records what it is
 * handed opens a delivery whose description names the run's id and the
 * time it was produced, above the proofs — so the report waiting on the
 * forge for a branch that was force-pushed twice can still be matched back
 * to the run it belongs to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchTep } from "../run/dispatch";
import { RunState } from "../run/state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "./schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "../run/shapes";
import type { RepoShape } from "../run/shapes";
import type { Forge } from "../dispatch/forge";

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

test("the pull request opened for a delivery names the run's id and produced-at time above the proofs", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-forge-stamp" };

  const opened: { branch: string; title: string; body: string }[] = [];
  const forge: Forge = {
    kind: "github",
    openDelivery: async (args) => {
      opened.push(args);
      return "https://example.invalid/pr/1";
    },
    merge: async () => {},
  };

  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      forge,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );

  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the run opened a delivery");
  assert.equal(opened.length, 1, "the stand-in forge was handed exactly one pull request");
  const body = opened[0].body;

  const runId = (outcome.delivery as unknown as { runId?: string }).runId;
  const producedAt = (outcome.delivery as unknown as { producedAt?: string }).producedAt;
  assert.ok(runId, "the delivery names the run that produced it");
  assert.ok(producedAt, "the delivery names when it was produced");

  const runIdIdx = body.indexOf(runId!);
  const producedAtIdx = body.indexOf(producedAt!);
  const proofsIdx = body.indexOf("Proofs:");

  assert.ok(runIdIdx >= 0, `PR description does not name the run id:\n${body}`);
  assert.ok(producedAtIdx >= 0, `PR description does not name the produced-at time:\n${body}`);
  assert.ok(proofsIdx >= 0, `PR description has no proofs section:\n${body}`);
  assert.ok(runIdIdx < proofsIdx, "the run id must appear above the proofs");
  assert.ok(producedAtIdx < proofsIdx, "the produced-at time must appear above the proofs");
});
