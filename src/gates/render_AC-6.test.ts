/**
 * TRANSITION — today the gate's undelivered list is built only from what
 * workers themselves confessed (docs obligations, stub-scan confessions);
 * a criterion the gate never graded at all was silently counted as kept,
 * because "kept" was read from proofs alone. Driven end to end with fakes:
 * a cut whose promise carries a criterion no proof mentions must come back
 * from closeGate with that criterion named in delivery.undelivered. Done
 * once the gate cross-checks its own criteria, not just its workers' words.
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

/** A tiny real git repository: `node --test <file>` runs its checks, and a
 *  probe that was never written fails as "no such file", never as a false
 *  green — closeGate's own veto rests on that being a real answer. */
function tinyRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-gate-repo-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", dir]);
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  g("add", "-A");
  g("commit", "-qm", "seed");
  return dir;
}

/** One slice whose tester wired a check for only ONE of the promise's two
 *  criteria. The other criterion is never named in any work unit's
 *  footprint, so closingVerifications never mints an ordinal for it and no
 *  proof — kept, red or unrunnable — will ever come to mention it. That is
 *  "a criterion no proof mentions" in practice, not a probe that was
 *  declared and then merely failed to land on disk. */
function sliceCheckingOnly(handle: string, criterionId: string): SliceForDag & { criterionIds: string[] } {
  const probe = `probes/gate__${handle}_AC-1.test.mjs`;
  return {
    handle,
    status: "ready",
    files: [],
    workUnits: [
      {
        footprint: [probe],
        execution: "serial",
        role: "test",
        note: "[a promise with two criteria] the first criterion",
      },
    ],
    satisfies: [1],
    criterionIds: [criterionId],
    contract: "",
  } as never;
}

test("a criterion no proof mentions is named in the delivery's undelivered list", async () => {
  const repo = tinyRepo();
  const worktree = repo;
  const baseSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a promise with two criteria",
        serves: [],
        needs: [],
        acceptance: [
          { id: "c1", text: "the first criterion is proved" },
          { id: "c2", text: "the second criterion is never proved by anything" },
        ],
        grounding: { touchpoints: [{ path: "README.md", planned: false }], stamp: [] },
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"], tepId: "TEP-undelivered" }],
  };
  const cut = { id: "cut-1", changeIds: ["n1"], tepId: "TEP-undelivered" };
  // Only c1 is checked by anything this cut wired. c2 gets no footprint
  // entry anywhere, so closeGate's own cross-check — not any confession —
  // is what must surface it.
  const slices = [sliceCheckingOnly("SL-1", "c1")];

  fs.mkdirSync(path.join(worktree, "probes"), { recursive: true });
  fs.writeFileSync(
    path.join(worktree, "probes", "gate__SL-1_AC-1.test.mjs"),
    `import { test } from "node:test";\ntest("ac1", () => {});\n`,
  );
  execFileSync("git", ["-C", worktree, "add", "-A"]);
  execFileSync("git", ["-C", worktree, "commit", "-qm", "work"]);

  const state = new RunState(() => {});
  const outcome = await closeGate({
    tep: "TEP-undelivered",
    branch: "tandem/TEP-undelivered",
    baseSha,
    worktree,
    slices,
    space,
    cut,
    deps: { repoRoot: repo, model: "sonnet", state } as never,
    runOne: proved("node --test <file>", true)!,
    sliceProbes: new Map([["SL-1", slices[0].workUnits[0].footprint]]),
    sliceCommitted: new Set(),
    checkOf: new Map([["probes/gate__SL-1_AC-1.test.mjs", "the first criterion is proved"]]),
    undelivered: [],
    rulings: [],
    decisions: [],
    // Exec answers with a code, exactly the contract `Exec` promises — it
    // never throws. A raw execFileSync call left this fake throwing on any
    // nonzero exit (including the final delivery push, which this tiny repo
    // has no remote to satisfy), which failed the whole probe before its own
    // assertion ever ran: a check-side bug, not a defect in closeGate.
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

  const undelivered = outcome.delivery?.undelivered ?? [];
  assert.ok(
    undelivered.some((u) => u.includes("the second criterion is never proved by anything")),
    `the criterion nothing judged is named as undelivered — got: ${JSON.stringify(undelivered)}`,
  );
});
