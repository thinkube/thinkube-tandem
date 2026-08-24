/**
 * TRANSITION — a delivery a run hands back does not yet name the run that
 * produced it. This proves the change: the delivery's `runId` is the same
 * id that heads that run's rows in the space's run log (`<store>/runs/<tep>.log`,
 * written by src/run/runLog.ts as `──── <runId> ────`), driven through
 * dispatchTep with a scripted worker and a temporary store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

test("the delivery a run hands back names the run that heads its own run-log rows", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-runid" };
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "runid",
      storeDir: store,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "runid" }),
  );
  assert.ok(outcome.delivery, "the run reached a delivery");
  const runId = (outcome.delivery as unknown as { runId?: string }).runId;
  assert.ok(runId, "the delivery names the run that produced it");

  const log = fs.readFileSync(path.join(store, "runs", "TEP-runid.log"), "utf8");
  const headed = new RegExp(`──── ${runId!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ────`);
  assert.match(log, headed, "the delivery's run id is the same id heading that run's rows in the run log");
});
