/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The closing gate does not run a suite the platform's pipeline runs as
 * part of going live; the live phase settles its proof. Every other
 * repository has its suite run at the gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { closeGate } from "./gate";
import { RunState } from "./state";
import { emptySpace, type Delivery } from "../core/schema";
import { proved } from "./proved";
import { goLiveAndJudge } from "./goingLive";
import { SUITE_IN_LIVE_PHASE, suiteLeftToLivePhase } from "./suiteInLivePhase";

function tree(o: { template: boolean }): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-gate-pipeline-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  if (o.template) {
    fs.writeFileSync(path.join(dir, "manifest.yaml"), "kind: TemplateManifest\nmetadata:\n  name: svc\n");
    fs.writeFileSync(
      path.join(dir, "thinkube.yaml"),
      [
        "apiVersion: thinkube.io/v1",
        "kind: ThinkubeDeployment",
        "spec:",
        "  containers:",
        "    - { name: svc, build: . }",
        "  deploy:",
        "    run: python3 scripts/deploy.py svc",
        "    at: https://svc.example.com",
        "",
      ].join("\n"),
    );
  }
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "base"]);
  return { dir, base: execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
}

async function gate(o: { template: boolean }) {
  const st = new RunState(() => {});
  const { dir: worktree, base } = tree(o);
  const suiteRan: string[] = [];
  const said: string[] = [];
  const out = await closeGate({
    tep: "TEP-1",
    branch: "tandem/TEP-1",
    baseSha: base,
    worktree,
    slices: [],
    space: emptySpace(),
    cut: { id: "cut-1", tepId: "TEP-1", changeIds: [] },
    deps: {
      repoRoot: worktree,
      state: st,
      build: "npm run build",
      model: "test",
      worker: async () => ({ ok: true, finalText: "UNDELIVERED: nothing here can fix it" }),
    },
    runOne: proved("npm test -- <file>", true)!,
    suite: proved("npm test", true)!,
    sliceProbes: new Map(),
    sliceCommitted: new Set(),
    checkOf: new Map(),
    undelivered: [],
    rulings: [],
    decisions: [],
    exec: async (cmd: string, args: string[]) => {
      try {
        return { code: 0, out: execFileSync(cmd, args, { encoding: "utf8", cwd: worktree, stdio: ["ignore", "pipe", "pipe"] }) };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
      }
    },
    boundedExec: async () => ({ code: 0, output: "built" }),
    suiteExec: async (cmd: string) => (suiteRan.push(cmd), { code: 0, output: "ok 1 - passes" }),
    state: st,
    sessionOf: () => undefined,
    worker: async () => ({ ok: true, finalText: "" }),
    machineAttention: () => 0,
    log: (l: string) => said.push(l),
    defect: () => {},
  } as never);
  return { out, suiteRan, said };
}

test("a template with a declared deploy does not run its suite at the gate; the live phase settles its proof", async () => {
  const { out, suiteRan, said } = await gate({ template: true });
  assert.deepEqual(suiteRan, [], `the suite never ran in the IDE: ${suiteRan.join(" · ")}`);
  assert.ok(
    said.some((l) => /suite is not run here — the template's declared deploy runs it in the platform pipeline's test step/.test(l)),
    said.join("\n"),
  );
  const proofs = out.delivery?.proofs ?? [];
  const suite = proofs.find((p) => p.label === "repo suite");
  assert.equal(suite?.verdict, "pending", JSON.stringify(proofs));
  assert.equal(suite?.settledBy, SUITE_IN_LIVE_PHASE);
  assert.ok(proofs.some((p) => p.label === "the declared build" && p.verdict === "green"), `the build is still judged here: ${JSON.stringify(proofs)}`);
});

test("a script repository still runs its suite at the gate", async () => {
  const { out, suiteRan } = await gate({ template: false });
  assert.ok(suiteRan.includes("npm test"), `the suite ran at the gate: ${suiteRan.join(" · ")}`);
  const suite = out.delivery?.proofs.find((p) => p.label === "repo suite");
  assert.equal(suite?.verdict, "green", JSON.stringify(out.delivery?.proofs ?? out.refusals));
  assert.equal(suite?.settledBy, undefined);
});

/** The live phase over a delivery whose suite was left to the pipeline. */
async function livePhase(went: { live: boolean; why?: string; unjudged?: boolean }, refusal = went.why ?? "") {
  let recorded: Delivery | undefined;
  const delivery = {
    id: "delivery-TEP-1",
    cutId: "cut-1",
    branch: "tandem/TEP-1",
    proofs: [suiteLeftToLivePhase("the template's declared deploy")],
  } as never as Delivery;
  await goLiveAndJudge({
    at: "https://svc.example.com",
    delivery,
    waiting: "deploying",
    goLive: async () => went,
    whyItFailed: async () => ({ evidence: refusal, files: [] }),
    said: "a validation deployment",
    settle: async (d) => d,
    repair: async () => ({ green: false, report: "no repair in this check" }),
    buildsHere: async () => ({ ok: true, output: "" }),
    land: async () => ({ ok: true }),
    halted: () => false,
    say: () => {},
    phase: () => {},
    noProduct: () => {},
    record: (d) => {
      recorded = d;
    },
    judge: async () => {},
    defect: () => {},
  });
  return recorded!.proofs.find((p) => p.label === "repo suite")!;
}

test("the live phase settles the suite green when the work went live", async () => {
  const p = await livePhase({ live: true });
  assert.equal(p.verdict, "green", JSON.stringify(p));
});

test("the live phase settles the suite red, in the pipeline's words, when its tests refused the work", async () => {
  const words = "step test-svc failed\nFAIL tests/test_api.py::test_segments - AssertionError: 404 != 200\n1 failed, 12 passed";
  const p = await livePhase({ live: false, why: "the declared deploy failed" }, words);
  assert.equal(p.verdict, "red", JSON.stringify(p));
  assert.match(p.ref ?? "", /FAIL tests\/test_api\.py::test_segments/);
});

test("a refusal that shows no test judging leaves the suite pending", async () => {
  const p = await livePhase({ live: false, why: "ImagePullBackOff" }, "pod svc: ImagePullBackOff");
  assert.equal(p.verdict, "pending", JSON.stringify(p));
  assert.match(p.ref ?? "", /still pending/);
});
