/**
 * TRANSITION — a delivery body could be built without the run that produced
 * it, so two runs of the SAME cut opened two pull requests whose bodies were
 * byte-identical: nothing on the forge said which run each came from, and a
 * re-run's delivery could not be told from the one it replaced. This proves
 * a run driven through dispatchTep with a fake forge opens a delivery whose
 * body names the run id and the moment it was produced, and that two runs of
 * the same cut through that fake produce two bodies differing in BOTH.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

/** Drive one whole run of the same cut at a scripted moment; return the
 *  body the fake forge was handed and the delivery's own run facts. */
async function runOnce(at: string): Promise<{
  body: string;
  runId: string;
  producedAt: string;
}> {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  // The delivery only opens when the push lands, so the fixture needs a
  // real remote — without one the forge is never reached.
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-remote-"));
  execFileSync("git", ["init", "-q", "--bare", remote], { encoding: "utf8" });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote], { encoding: "utf8" });

  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-run-identity" };
  let capturedBody: string | undefined;
  const forge: Forge = {
    kind: "github",
    openDelivery: async ({ body }) => {
      capturedBody = body;
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
      spaceName: "run-identity",
      now: () => at,
      forge,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "run-identity" }),
  );

  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the delivery opened");
  assert.ok(capturedBody, "the fake forge was handed a body");
  const stamped = outcome.delivery as unknown as { runId?: string; producedAt?: string };
  assert.ok(stamped.runId, "the delivery carries a run id");
  assert.ok(stamped.producedAt, "the delivery carries a produced-at moment");
  return { body: capturedBody!, runId: stamped.runId!, producedAt: stamped.producedAt! };
}

test("a run opens a delivery whose body names the run id and the moment it was produced", async () => {
  const AT = "2026-08-24T11:00:00.000Z";
  const first = await runOnce(AT);

  assert.equal(first.producedAt, AT, "the produced-at moment comes from the injected clock");
  assert.ok(
    first.body.includes(first.runId),
    `the body does not name the run id (${first.runId}):\n${first.body}`,
  );
  assert.ok(
    first.body.includes(AT),
    `the body does not name the moment it was produced (${AT}):\n${first.body}`,
  );
});

test("two runs of the same cut produce two bodies differing in both run id and moment", async () => {
  const AT_ONE = "2026-08-24T11:00:00.000Z";
  const AT_TWO = "2026-08-24T15:30:00.000Z";
  const first = await runOnce(AT_ONE);
  const second = await runOnce(AT_TWO);

  assert.notEqual(first.runId, second.runId, "two runs of the same cut mint two run ids");
  assert.notEqual(first.producedAt, second.producedAt, "and two produced-at moments");
  assert.equal(second.producedAt, AT_TWO, "the second run's moment comes from its own clock");

  // The bodies must differ in BOTH facts — not merely be unequal somewhere.
  assert.ok(first.body.includes(first.runId), "the first body names its own run");
  assert.ok(second.body.includes(second.runId), "the second body names its own run");
  assert.ok(
    !second.body.includes(first.runId),
    "the second body still carries the first run's id",
  );
  assert.ok(first.body.includes(AT_ONE), "the first body names its own moment");
  assert.ok(second.body.includes(AT_TWO), "the second body names its own moment");
  assert.ok(
    !second.body.includes(AT_ONE),
    "the second body still carries the first run's moment",
  );
  assert.notEqual(first.body, second.body, "the two bodies are not identical");
});
