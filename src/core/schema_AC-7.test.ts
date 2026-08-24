/**
 * TRANSITION — the pull request body the forge opens does not yet name the
 * run that produced the delivery. This proves that when a delivery opens,
 * the body handed to the forge names the run's id and its produced-at time
 * in its first lines, before the proofs list — so the forge-side record of
 * the delivery is traceable to the run that made it, same as the page.
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

test("the delivery body handed to the forge names the run id and produced-at before the proofs list", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  // The delivery only opens when the push lands, so this fixture needs a
  // real remote to push to — without one the forge is never reached and
  // the body under test is never built.
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-remote-"));
  execFileSync("git", ["init", "-q", "--bare", remote], { encoding: "utf8" });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote], { encoding: "utf8" });
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-forge-body" };
  const FIXED_AT = "2026-08-24T11:00:00.000Z";
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
      spaceName: "forge-body",
      now: () => FIXED_AT,
      forge,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "forge-body" }),
  );

  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the delivery opened");
  assert.ok(capturedBody, "the forge was handed a body");
  const runId = (outcome.delivery as unknown as { runId?: string }).runId!;
  assert.ok(runId, "the delivery carries a run id to check the body against");
  const lines = capturedBody!.split("\n");
  const runIdLine = lines.findIndex((l) => l.includes(runId));
  const producedAtLine = lines.findIndex((l) => l.includes(FIXED_AT));
  const proofsLine = lines.findIndex((l) => /^proofs:/i.test(l.trim()));

  assert.ok(runIdLine >= 0, `the body names the run id: ${capturedBody}`);
  assert.ok(producedAtLine >= 0, `the body names the produced-at time: ${capturedBody}`);
  assert.ok(
    runIdLine <= 3 && producedAtLine <= 3,
    "both appear in the first lines of the body",
  );
  assert.ok(
    proofsLine === -1 || (runIdLine < proofsLine && producedAtLine < proofsLine),
    "both appear before the proofs list",
  );
});
