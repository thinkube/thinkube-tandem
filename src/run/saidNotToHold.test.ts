/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A criterion a person said does not hold reaches a worker with their
 * words on the next run, even when its checks pass: the person's words are
 * the evidence, and an unchanged tree does not answer them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { repairUnkept } from "./unkept";
import { RunState } from "./state";
import { emptySpace, type Proof, type Space } from "../core/schema";
import { contradictedAmong, contradictionWords } from "../core/contradiction";

const SAID = "the platform's test step fails with 12 errors: tests/compare_AC-10 gets 503";

function space(o: { provedAt: string }): Space {
  return {
    ...emptySpace(),
    nodes: [{ id: "n1", sentence: "every scoring route checks the token", acceptance: [{ id: "c1", text: "a route without a token is refused" }] }],
    deliveries: [{ id: "d1", cutId: "cut-1", branch: "b", producedAt: o.provedAt, proofs: [{ kind: "probe", label: "x", verdict: "green", criterionId: "c1" }] }],
    contradictions: [{ criterionId: "c1", at: "2026-10-17T10:06:47.287Z", by: "cmxela", source: "person", said: `${SAID}\nEach passes alone.` }],
  } as never as Space;
}

test("a contradiction newer than the last proof is one of the cut's criteria not holding; an answered one is not", () => {
  const open = contradictedAmong(space({ provedAt: "2026-10-17T10:03:20.000Z" }), ["n1"]);
  assert.deepEqual([...open.keys()], ["c1"]);
  assert.equal(contradictionWords(open.get("c1")!), `cmxela said it does not hold: ${SAID} Each passes alone.`);
  assert.equal(contradictedAmong(space({ provedAt: "2026-10-17T11:00:00.000Z" }), ["n1"]).size, 0);
  assert.equal(contradictedAmong(space({ provedAt: "2026-10-17T10:03:20.000Z" }), ["n2"]).size, 0);
});

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-said-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "base"]);
  return dir;
}

test("a green criterion said not to hold goes to a worker with the person's words, and is kept once the tree changed", async () => {
  const worktree = repo();
  const briefs: string[] = [];
  const words = `cmxela said it does not hold: ${SAID}`;
  const proofs: Proof[] = [{ kind: "probe", label: "a route without a token is refused", verdict: "green", criterionId: "c1" }];
  const st = new RunState(() => {});
  const left = await repairUnkept({
    tep: "TEP-1",
    worktree,
    slices: [],
    space: emptySpace(),
    cut: { id: "cut-1", tepId: "TEP-1", changeIds: [] },
    deps: {
      repoRoot: worktree,
      state: st,
      model: "test",
      worker: async (_d: unknown, brief: string) => {
        briefs.push(brief);
        fs.writeFileSync(path.join(worktree, "tests_conftest.py"), "# restored\n");
        return { ok: true, finalText: "UNDELIVERED: none" };
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
    saidNotToHold: new Map([["c1", words]]),
  });
  assert.equal(briefs.length, 1, "a worker was sent, though the check is green");
  assert.ok(briefs[0].includes(SAID), "the person's words are in its brief");
  assert.deepEqual(left, [], "once the tree changed, the check's own verdict stands");
  assert.equal(proofs[0].verdict, "green");
});
