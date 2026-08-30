/**
 * INVARIANT — every unit the second of two runs against the same store and
 * repository leaves in state "done" must have at least one line in its own
 * step log: a unit whose slice stands from the first run's commit still
 * needs a standing-pass line recorded under its own id, so the surface's
 * proof-of-pass never shows a bare "done" with an empty log behind it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

test("every unit left 'done' by the second run of the same cut has its own step log", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-standing-log" };

  const once = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "delivers",
      storeDir: store,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(once.delivery && !once.delivery.withheld, "the first run delivered");

  const secondState = new RunState(() => {});
  const again = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
      state: secondState,
      supervisorRound: async () => null,
      spaceName: "delivers",
      storeDir: store,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "delivers" }),
  );
  assert.ok(again.delivery, "the second run reached a delivery");

  const doneUnits = [...secondState.units.values()].filter((u) => u.state === "done");
  assert.ok(doneUnits.length > 0, "the second run must have left at least one unit done, standing or otherwise");
  const empty = doneUnits.filter((u) => secondState.logTail(u.id).lines.length === 0);
  assert.deepEqual(
    empty.map((u) => u.id),
    [],
    "no unit left 'done' has an empty step log — its own log names why it counts as passed",
  );
});
