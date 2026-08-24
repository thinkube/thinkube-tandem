/**
 * TRANSITION — the delivery opened on the forge does not yet name the run
 * that produced it in its body. This proves that with a fake forge that
 * records what it was handed, the body passed to openDelivery names the run
 * id and the produced-at moment of the run that opened it — so a re-run
 * that force-pushes the same branch cannot leave a body read as this run's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { dispatchTep } from "../run/dispatch";
import { RunState } from "../run/state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "../run/shapes";
import type { RepoShape } from "../run/shapes";
import type { Forge } from "../dispatch/forge";

/** A bare remote for the fixture, so the run's push succeeds and the forge
 *  is actually asked to open the delivery — with no remote configured the
 *  push is honestly red and openDelivery is never reached. */
function withRemote(repo: string): void {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-remote-"));
  execFileSync("git", ["init", "-q", "--bare", bare]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", bare]);
  execFileSync("git", ["-C", repo, "push", "-q", "origin", "HEAD:refs/heads/main"]);
}

function oneAsk() {
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

test("the body opened on the forge names the run id and the produced-at moment of the run that opened it", async () => {
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  withRemote(repo);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-forge" };
  const opened: { branch: string; title: string; body: string }[] = [];
  const fakeForge: Forge = {
    kind: "gitea",
    openDelivery: async (args) => {
      opened.push(args);
      return "https://forge.example/pulls/1";
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
      spaceName: "forge",
      forge: fakeForge,
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "forge" }),
  );
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the run delivered");
  assert.equal(opened.length, 1, "the delivery was opened on the forge");
  const delivery = outcome.delivery as unknown as { runId?: string; producedAt?: string };
  assert.ok(delivery.runId, "the run minted a run id");
  assert.ok(delivery.producedAt, "the run minted a produced-at");
  assert.ok(
    opened[0].body.includes(delivery.runId!),
    `the body names the run id: ${opened[0].body.slice(0, 200)}`,
  );
  assert.ok(
    opened[0].body.includes(delivery.producedAt!),
    `the body names the produced-at moment: ${opened[0].body.slice(0, 200)}`,
  );
});
