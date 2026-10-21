/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The closer's verify always says what it ran, or why it ran nothing —
 * including when every change is under the live home, whose checks only
 * run against the deployed service.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { repairUnkept } from "./unkept";
import { RunState } from "./state";
import { emptySpace, type Proof } from "../core/schema";

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-closer-verify-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.writeFileSync(
    path.join(dir, "thinkube.yaml"),
    ["spec:", "  deploy:", "    run: python3 scripts/deploy.py svc", "    at: https://svc.example.com", "    live:", "      home: live", '      one: "pytest <file>"', ""].join("\n"),
  );
  fs.mkdirSync(path.join(dir, "live"));
  fs.writeFileSync(path.join(dir, "live", "retrieval_AC-1_test.py"), "import httpx\n");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "base"]);
  return dir;
}

test("a closer whose changes are only under the live home is told so by its verify", async () => {
  const worktree = repo();
  const verified: string[] = [];
  let round = 0;
  const proofs: Proof[] = [{ kind: "probe", label: "every live call sends the token", verdict: "red", criterionId: "c1", ref: "RED: no token" }];
  await repairUnkept({
    tep: "TEP-1",
    worktree,
    slices: [],
    space: emptySpace(),
    cut: { id: "cut-1", tepId: "TEP-1", changeIds: [] },
    deps: {
      repoRoot: worktree,
      state: new RunState(() => {}),
      model: "test",
      worker: async (d: { verifyTool?: () => Promise<string> }) => {
        round++;
        fs.writeFileSync(path.join(worktree, "live", "retrieval_AC-1_test.py"), `import httpx\n# round ${round}\n`);
        verified.push(await d.verifyTool!());
        return { ok: true, finalText: "UNDELIVERED: the live checks need the deployed service" };
      },
    } as never,
    proofs,
    observations: [],
    verifs: [],
    probeOfAc: new Map(),
    criterionByProbe: new Map(),
    checkOf: new Map(),
    sliceProbes: new Map(),
    sessionOf: () => undefined,
    worker: async () => ({ ok: true, finalText: "" }),
    baseSha: "HEAD",
    halted: () => false,
    doing: () => {},
    rulings: [],
    exec: async (cmd: string, args: string[]) => {
      try {
        return { code: 0, out: execFileSync(cmd, args, { encoding: "utf8", cwd: worktree, stdio: ["ignore", "pipe", "pipe"] }) };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
      }
    },
    boundedExec: async () => ({ code: 0, output: "" }),
    suiteExec: async () => ({ code: 0, output: "" }),
    log: () => {},
    defect: () => {},
  });
  assert.ok(verified.length >= 1);
  for (const v of verified) assert.match(v, /What ran: /, `the verify said what it ran: ${v}`);
  assert.match(verified[0], /^RED — 1 promise\(s\) not kept\. What ran: 1 file\(s\) changed; re-ran 0 check\(s\)/);
  assert.match(verified[0], /Every change is under the live home \(live\), whose checks run against the deployed service after the deploy/);
});
