/**
 * INVARIANT — a criterion whose check comes back green must never be named
 * in the delivery's undelivered list. Naming a kept promise as undelivered
 * would tell a person their work is missing something it actually built,
 * and the two facts — the gate's own kept-or-withheld verdict and the
 * undelivered list — must always agree about a criterion that passed. This
 * must hold for as long as closeGate assembles delivery.undelivered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { closeGate } from "../run/gate";
import { RunState } from "../run/state";
import { emptySpace } from "../core/schema";
import { proved } from "../run/proved";
import type { SliceForDag } from "../engine/core/dag";

/**
 * A tiny repository already on the branch the gate expects, with an
 * `origin` it can actually push to. A kept delivery pushes unconditionally
 * on its way out — the setup must give that push somewhere to land, or the
 * criterion under test is never reached.
 */
function tinyRepo(branch: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-gate-repo-"));
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-gate-origin-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", dir]);
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("remote", "add", "origin", origin);
  g("checkout", "-q", "-b", branch);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  g("add", "-A");
  g("commit", "-qm", "seed");
  return dir;
}

function sliceWithProbes(handle: string, criterionIds: string[]): SliceForDag & { criterionIds: string[] } {
  const footprint = criterionIds.map((_, k) => `probes/gate__${handle}_AC-${k + 1}.test.mjs`);
  return {
    handle,
    status: "ready",
    files: [],
    workUnits: [
      {
        footprint,
        execution: "serial",
        role: "test",
        note: "[a promise with one criterion] the criterion",
      },
    ],
    satisfies: criterionIds.map((_, k) => k + 1),
    criterionIds,
    contract: "",
  } as never;
}

test("a criterion whose proof came back green is not named as undelivered", async () => {
  const branch = "tandem/TEP-kept";
  const repo = tinyRepo(branch);
  const worktree = repo;
  const baseSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a promise with one criterion",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the criterion is proved and stays out of undelivered" }],
        grounding: { touchpoints: [{ path: "README.md", planned: false }], stamp: [] },
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-kept" }],
  };
  const cut = { id: "cut-1", changeIds: ["n1"], tepId: "TEP-kept" };
  const slices = [sliceWithProbes("SL-1", ["c1"])];

  // The declared probe is written AND passes.
  fs.mkdirSync(path.join(worktree, "probes"), { recursive: true });
  fs.writeFileSync(
    path.join(worktree, "probes", "gate__SL-1_AC-1.test.mjs"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("ac1", () => assert.equal(1, 1));\n`,
  );
  execFileSync("git", ["-C", worktree, "add", "-A"]);
  execFileSync("git", ["-C", worktree, "commit", "-qm", "work"]);

  const state = new RunState(() => {});
  const outcome = await closeGate({
    tep: "TEP-kept",
    branch,
    baseSha,
    worktree,
    slices,
    space,
    cut,
    deps: { repoRoot: repo, model: "sonnet", state } as never,
    runOne: proved("node --test <file>", true)!,
    sliceProbes: new Map([["SL-1", slices[0].workUnits[0].footprint]]),
    sliceCommitted: new Set(),
    checkOf: new Map([["probes/gate__SL-1_AC-1.test.mjs", "the criterion is proved and stays out of undelivered"]]),
    undelivered: [],
    rulings: [],
    decisions: [],
    exec: async (cmd: string, args: string[], cwd: string) => {
      try {
        const r = execFileSync(cmd, args, { cwd, encoding: "utf8" });
        return { code: 0, out: r };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    },
    boundedExec: async (cmd: string, cwd: string) => {
      try {
        const r = execFileSync(cmd, { cwd, shell: true, encoding: "utf8" });
        return { code: 0, output: r };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    },
    suiteExec: async () => ({ code: 0, output: "" }),
    state,
    sessionOf: () => undefined,
    worker: async () => ({ ok: true, finalText: "" }),
    machineAttention: () => 0,
    log: () => {},
    defect: () => {},
  } as never);

  assert.ok(outcome.delivery, "the run reached a delivery");
  const undelivered = outcome.delivery?.undelivered ?? [];
  assert.ok(
    !undelivered.some((u) => u.includes("the criterion is proved and stays out of undelivered")),
    `a kept criterion must not be named as undelivered — got: ${JSON.stringify(undelivered)}`,
  );
});
