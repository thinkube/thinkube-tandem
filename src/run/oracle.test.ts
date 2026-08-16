import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultExec, OracleFactoryArgs, sliceOracleFactory } from "./oracle";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo, writeInto } from "./runHarness";

const PROBE = "probes/space__SL-1_AC-1.test.mjs";

/** A repository with a run branch, a code worktree on it, and a tester
 *  snapshot holding one probe — the trees a slice oracle needs. */
function trees() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-oracle-repo-"));
  const g = (args: string[], cwd = repoRoot) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", "-b", "main", repoRoot], { encoding: "utf8" });
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(repoRoot, "a.txt"), "a");
  g(["add", "-A"]);
  g(["commit", "-qm", "base"]);
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-oracle-wt-"));
  const worktree = path.join(wtRoot, "run");
  g(["worktree", "add", "-q", "-b", "tandem/run", worktree]);
  const testerWt = path.join(wtRoot, "run-tester");
  g(["worktree", "add", "-q", "--detach", testerWt, "tandem/run"]);
  fs.mkdirSync(path.join(testerWt, "probes"), { recursive: true });
  fs.writeFileSync(path.join(testerWt, PROBE), "probe");
  return { repoRoot, wtRoot, worktree, testerWt };
}

test("the oracle's lines land under the unit it acts for, and a baseline read is never reviewed", async () => {
  const t = trees();
  const said: { line: string; step?: string }[] = [];
  const supervised: string[] = [];
  let acting: { unit: string; baseline: boolean } | undefined;
  const args = {
    ...t,
    branch: "tandem/run",
    tep: "TEP-1",
    sliceProbes: new Map([["SL-1", [PROBE]]]),
    sliceVerifs: new Map([["SL-1", [{ ac: 1, run: "node --test " + PROBE }]]]),
    briefBySlice: new Map([["SL-1", "the brief"]]),
    model: "opus",
    exec: defaultExec,
    // Every check fails: the round is red, which is what invites review.
    boundedExec: async () => ({ code: 1, output: "assertion failed" }),
    supervisorRound: async (_deps: unknown, prompt: string) => {
      supervised.push(prompt);
      return "CITE: the brief already says so";
    },
    log: (line: string, step?: string) => said.push({ line, ...(step ? { step } : {}) }),
    defect: () => {},
    acting: () => acting,
  } as unknown as OracleFactoryArgs;
  const oracle = sliceOracleFactory(args)("SL-1")!;

  acting = { unit: "SL-1#eu-0", baseline: true };
  const pre = await oracle.confirmGreen();
  assert.equal(pre.green, false);
  assert.equal(supervised.length, 0, "an unchanged tree failing its checks is expected — nothing to review");

  acting = { unit: "SL-1#eu-0", baseline: false };
  await oracle.verify();
  assert.equal(supervised.length, 1, "a real red round is reviewed");

  const oracleLines = said.filter((s) => s.line.includes("[oracle]"));
  assert.ok(oracleLines.length >= 2, "the oracle spoke");
  assert.ok(
    oracleLines.every((s) => s.step === "SL-1#eu-0"),
    "every oracle line carries the unit it acted for — the unit's log is not silent while work is done in its name",
  );
});

test("a worker's question goes to the machine first: the supervisor answers what the run knows, and only an intent question reaches the human", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-31" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const humanSaw: string[] = [];
  const origPark = state.park.bind(state);
  state.park = (id, q, answer) => {
    humanSaw.push(q);
    origPark(id, q, answer);
    setImmediate(() => state.answer(id, "the human says: hello"));
  };
  const answers: string[] = [];
  let asked = 0;
  await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async (_d, prompt) => {
        if (prompt.includes("THE WORKER'S QUESTION")) asked++;
        if (prompt.includes("may I add a test")) return "ANSWER: No. You never touch a test file; the tester owns every test. Continue with src/greet.mjs only.";
        if (prompt.includes("formal or casual")) return "ESCALATE: should the greeting be formal or casual?";
        return null;
      },
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          answers.push(await new Promise<string>((resolve) => w.onPark("may I add a test to src/greet.test.mjs?", resolve)));
          answers.push(await new Promise<string>((resolve) => w.onPark("formal or casual greeting?", resolve)));
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.equal(asked, 2, "every question went to the supervisor first");
  assert.match(answers[0], /never touch a test file/, "an internals question is answered by the machine");
  assert.equal(answers[1], "the human says: hello");
  assert.deepEqual(humanSaw, ["should the greeting be formal or casual?"], "the human saw one question, in intent terms");
});
