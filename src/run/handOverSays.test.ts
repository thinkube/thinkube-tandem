/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The hand-over says the platform is building the work only where a push
 * builds it: an app the platform deploys from its repository. A template
 * pushed to its forge is built by nobody until its own deploy runs, and
 * saying otherwise sent a person to wait for a build that never started.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handOver } from "./handOver";
import { emptySpace } from "../core/schema";

function gitRepo(prefix: string, remote?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
  if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote], { stdio: "ignore" });
  return dir;
}

async function said(repoRoot: string): Promise<string[]> {
  const lines: string[] = [];
  await handOver({
    tep: "TEP-1",
    branch: "tandem/x/TEP-1",
    // A clean tree: nothing to commit, and nothing is touched.
    worktree: gitRepo("tandem-handover-wt-"),
    space: emptySpace(),
    cut: { id: "cut-1", changeIds: [] } as never,
    deps: { repoRoot } as never,
    runId: "run-1",
    producedAt: "2026-10-15T00:00:00.000Z",
    proofs: [],
    observations: [],
    undelivered: [],
    findings: [],
    rulings: [],
    decisions: [],
    kept: [],
    recordPath: undefined,
    exec: async () => ({ code: 0, out: "" }),
    land: async () => ({ ok: true, pushed: true, moved: true, head: "a".repeat(40) }),
    log: (l) => lines.push(l),
  });
  return lines;
}

test("an app's hand-over says the platform is building it", async () => {
  const app = gitRepo("tandem-handover-app-", "https://git.example.com/thinkube-deployments/todo.git");
  assert.ok((await said(app)).includes("TEP-1: merged and pushed — the platform is building it"));
});

test("a template's hand-over says only that it was merged and pushed", async () => {
  const tpl = gitRepo("tandem-handover-tpl-", "git@github.com:someone/tkt-svc.git");
  fs.writeFileSync(path.join(tpl, "manifest.yaml"), "kind: TemplateManifest\n");
  fs.writeFileSync(path.join(tpl, "thinkube.yaml"), "spec: {}\n");
  const lines = await said(tpl);
  assert.ok(lines.includes("TEP-1: merged and pushed"), lines.join("\n"));
  assert.ok(!lines.some((l) => /the platform is building it/.test(l)));
});
