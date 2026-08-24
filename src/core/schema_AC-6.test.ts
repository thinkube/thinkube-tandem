/**
 * INVARIANT — the run id and the produced-at stamp of one run must always
 * come from a single reading of the run's clock, so the id heading the run
 * log's rows and defect rows and the produced-at on the minted delivery can
 * never name different moments. With the run's clock seam scripted to a
 * fixed moment, every one of those must derive from that same moment.
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

test("the run id and the delivery's produced-at both derive from the same scripted clock reading", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-clock" };
  const FIXED_MOMENT = 1_700_000_000_000; // one fixed moment, read once

  // A worker whose code never satisfies the check, and never changes: the
  // run still reaches a (withheld) delivery, but also writes a defect row —
  // the AC's second stamped surface, beside the run log and the delivery.
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state: new RunState(() => {}),
      supervisorRound: async () => null,
      spaceName: "clock",
      storeDir: store,
      now: () => FIXED_MOMENT,
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "clock" }),
  );
  assert.ok(outcome.delivery, "the run reached a terminal delivery");
  const delivery = outcome.delivery as unknown as { runId?: string; producedAt?: string };
  assert.ok(delivery.runId?.includes(FIXED_MOMENT.toString(36)), "the run id derives from the scripted moment");
  assert.equal(
    delivery.producedAt,
    new Date(FIXED_MOMENT).toISOString(),
    "the produced-at is the ISO rendering of that same scripted moment",
  );

  const log = fs.readFileSync(path.join(store, "runs", "TEP-clock.log"), "utf8");
  assert.match(
    log,
    new RegExp(`──── ${delivery.runId!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ────`),
    "the same run id heads the run log's rows",
  );

  const ym = new Date(FIXED_MOMENT).toISOString().slice(0, 7);
  const defects = fs
    .readFileSync(path.join(store, "defects", `${ym}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { run?: string; spec?: string });
  const mine = defects.filter((d) => d.spec === "TEP-clock");
  assert.ok(mine.length > 0, "the run wrote at least one defect row");
  assert.ok(
    mine.every((d) => d.run === delivery.runId),
    `every defect row this run wrote carries the same run id as the delivery: ${mine.map((d) => d.run).join(", ")}`,
  );
});
