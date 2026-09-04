/**
 * A tree that does not build is not handed over — even where no suite runs.
 *
 * An app's tests run in the platform's pipeline, after the merge, so the
 * gate has no whole-suite command it can run here. It skipped judging the
 * tree altogether, and with it the one judgement it could make: the
 * repository's own product build. A check the run wrote did not
 * type-check, every test passed because the test runner does not
 * type-check, the work was merged, and the platform's build rejected it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeGate } from "./gate";
import { RunState } from "./state";
import { emptySpace } from "../core/schema";
import { proved } from "./proved";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/** A real repository, so the gate can ask git whose tree it is judging. */
function tree(): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-gate-build-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  execFileSync("git", ["-C", dir, "add", "a.txt"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "base"]);
  return { dir, base: execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
}

/** The gate, with nothing to run but the build this repository declares. */
async function gateWithNoSuite(build: { code: number; output: string }) {
  const st = new RunState(() => {});
  const { dir: worktree, base } = tree();
  const ran: string[] = [];
  const said: string[] = [];
  const out = await closeGate({
    tep: "TEP-1",
    branch: "tandem/TEP-1",
    baseSha: base,
    worktree,
    slices: [],
    space: emptySpace(),
    cut: { id: "cut-1", tepId: "TEP-1", changeIds: [] },
    deps: { repoRoot: worktree, state: st, build: "npm run build" },
    runOne: proved("npm test -- <file>", true)!,
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
    boundedExec: async (cmd: string) => {
      ran.push(cmd);
      return cmd === "npm run build" ? build : { code: 0, output: "" };
    },
    suiteExec: async (cmd: string) => (ran.push(cmd), { code: 0, output: "" }),
    state: st,
    sessionOf: () => undefined,
    worker: async () => ({ ok: true, finalText: "" }),
    machineAttention: () => 0,
    land: async () => ({ ok: true, pushed: true, head: "deadbeef" }),
    log: (l: string) => said.push(l),
    defect: () => {},
  } as never);
  return { out, ran, said };
}

test("with no suite that runs here, the gate judges the tree by the repository's own build", async () => {
  const { ran, said } = await gateWithNoSuite({ code: 0, output: "built" });
  assert.ok(ran.includes("npm run build"), `the build ran: ${ran.join(" · ")}`);
  assert.ok(
    said.some((l) => /judged by its own product build/.test(l)),
    `and the gate says what it is judging: ${said.join(" · ")}`,
  );
});

test("a build that fails is a red the gate answers for — never a silent hand-over", async () => {
  const { out, ran } = await gateWithNoSuite({
    code: 2,
    output: "src/lib/taskView_AC-13.test.tsx(52,61): error TS2345: Argument of type ... is not assignable",
  });
  assert.ok(ran.includes("npm run build"), "the build ran");
  assert.ok(
    !out.delivery || out.delivery.withheld,
    `a tree its own build rejects is not merged: ${JSON.stringify(out.delivery?.withheld ?? out.refusals)}`,
  );
  const why = `${out.delivery?.withheld ?? ""}${out.refusals.join(" ")}`;
  assert.match(why, /build/i, "and the reason names the build");
});
