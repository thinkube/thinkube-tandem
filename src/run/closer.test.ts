/**
 * The floor of the ladder, as a fact rather than a sentence.
 *
 * A run gave the closer "full sight and full authority" in its brief and
 * neither in code: it was shown a verdict that said 7/7 green while the
 * thing failing it went unnamed, it was scored on a number that could not
 * move, it was fenced out of the file it had to change, and what it did fix
 * it wrote into a tree nobody commits. Each of those is pinned here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { close } from "./closer";
import type { WorkerOutcome } from "./worker";

function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-closer-"));
  fs.mkdirSync(path.join(dir, "probes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "probes", "p.test.mjs"), "// a check\n");
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
  return dir;
}

const base = (over: Record<string, unknown>) => ({
  subject: "SL-6#eu-0",
  footprint: ["src/spaceTabs.ts"],
  probeSources: [{ path: "probes/p.test.mjs", source: "// a check" }],
  history: [],
  criteria: [{ id: "c1", text: "two spaces open, both marked open" }],
  model: "sonnet",
  exec: async () => ({ code: 0, out: "" }),
  boundedExec: async () => ({ code: 0, output: "" }),
  halted: () => false,
  log: () => {},
  say: () => {},
  onRuling: () => {},
  defect: () => {},
  ...over,
});

test("the closer takes the files the evidence says are failing it, and is told which tree is committed", async () => {
  const worktree = gitRepo();
  const checks = gitRepo();
  const seen: { footprint: string[]; brief: string }[] = [];
  let round = 0;
  const result = await close(
    base({
      worktree,
      checks: { root: checks, paths: ["probes/p.test.mjs"] },
      // Red for a standing test in a file the unit does not own: exactly the
      // shape that failed four units whose own checks were all green.
      measure: async () => ({
        green: round > 0,
        score: round > 0 ? 0 : 2,
        evidence: "7/7 probes pass\n\nYOURS — src/gates/sign.ts refuses the cut",
        alsoOwn: ["src/gates/sign.ts"],
      }),
      worker: async (deps: { footprint: string[] }, brief: string): Promise<WorkerOutcome> => {
        seen.push({ footprint: deps.footprint, brief });
        round++;
        return { ok: true, finalText: "done" };
      },
    }) as never,
  );
  assert.equal(result.green, true, "it finished once it could reach what was failing it");
  assert.equal(seen.length, 1);
  assert.ok(seen[0].footprint.includes("src/gates/sign.ts"), "the file the evidence named is its own to edit");
  assert.ok(
    seen[0].footprint.includes(path.join(checks, "probes/p.test.mjs")),
    "and the checks, at their own absolute path",
  );
  assert.match(seen[0].brief, new RegExp(`PRODUCTION: EDIT THESE, IN ${worktree}`));
  assert.match(seen[0].brief, /THE CHECKS: A SEPARATE TREE/);
  assert.match(seen[0].brief, /WHERE IT STANDS NOW[\s\S]*sign\.ts refuses the cut/, "it is shown what fails it");
});

test("production written into the checks' tree is put back — that tree is never committed", async () => {
  const worktree = gitRepo();
  const checks = gitRepo();
  let round = 0;
  await close(
    base({
      worktree,
      checks: { root: checks, paths: ["probes/p.test.mjs"] },
      measure: async () => ({ green: round > 0, score: 1, evidence: "one red" }),
      worker: async (): Promise<WorkerOutcome> => {
        round++;
        // What the closer did in the field: read the tester's tree, and
        // wrote its real fix there. The branch never saw it.
        fs.writeFileSync(path.join(checks, "extension.ts"), "the fix\n");
        fs.writeFileSync(path.join(checks, "probes", "p.test.mjs"), "// corrected\n");
        return { ok: true, finalText: "done" };
      },
    }) as never,
  );
  assert.equal(fs.existsSync(path.join(checks, "extension.ts")), false, "the stray production file is gone");
  assert.equal(
    fs.readFileSync(path.join(checks, "probes", "p.test.mjs"), "utf8"),
    "// corrected\n",
    "a corrected check stands: that is what this tree is for",
  );
});

test("no progress means the evidence stopped moving, and the report says what remains", async () => {
  const worktree = gitRepo();
  let rounds = 0;
  const result = await close(
    base({
      worktree,
      measure: async () => ({ green: false, score: 3, evidence: "three red" }),
      worker: async (): Promise<WorkerOutcome> => {
        rounds++;
        return { ok: true, finalText: "UNDELIVERED: AC-5 needs a getter on a class I cannot reach" };
      },
    }) as never,
  );
  assert.equal(result.green, false);
  assert.equal(rounds, 2, "two rounds that changed nothing end it — progress, never patience");
  assert.match(result.report, /UNDELIVERED: AC-5/);
});
