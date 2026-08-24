/**
 * TRANSITION — the delivery record written to the store
 * (`<store>/deliveries/<tep>.json`) does not yet carry a run identity. This
 * proves a run driven through dispatchTep with a scripted worker and a
 * temporary store leaves a record whose run id and produced-at match the
 * Delivery the run returned, and that a second run of the same cut leaves a
 * record with a DIFFERENT run id and a LATER produced-at stamp.
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

function readRecord(store: string, tep: string): { runId?: string; producedAt?: string } {
  return JSON.parse(fs.readFileSync(path.join(store, "deliveries", `${tep}.json`), "utf8"));
}

test("the delivery record on disk carries the same run id and produced-at as the delivery the run returned, and a second run's record differs and is later", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-record" };

  const once = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "record",
      storeDir: store,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "record" }),
  );
  assert.ok(once.delivery && !once.delivery.withheld, "the first run delivered");
  const firstDelivery = once.delivery as unknown as { runId?: string; producedAt?: string };
  const firstRecord = readRecord(store, "TEP-record");
  assert.equal(firstRecord.runId, firstDelivery.runId, "the record's run id matches the delivery's");
  assert.equal(firstRecord.producedAt, firstDelivery.producedAt, "the record's produced-at matches the delivery's");
  assert.ok(firstRecord.runId, "a run id was actually minted");

  const again = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "record",
      storeDir: store,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "record" }),
  );
  assert.ok(again.delivery, "the second run reached a delivery");
  const secondRecord = readRecord(store, "TEP-record");
  assert.notEqual(secondRecord.runId, firstRecord.runId, "the second run's record names a different run id");
  assert.ok(
    secondRecord.producedAt && firstRecord.producedAt && secondRecord.producedAt > firstRecord.producedAt,
    "the second run's record carries a later produced-at stamp",
  );
});
