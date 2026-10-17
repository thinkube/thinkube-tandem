/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An actor at the gate that ran the whole suite and saw it red says so in
 * a `SUITE RED:` line, and the gate does not merge past it — even where
 * the suite is left to the platform's pipeline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { closeGate } from "./gate";
import { closerBrief } from "./closer";
import { RunState } from "./state";
import { emptySpace } from "../core/schema";
import { proved } from "./proved";
import { SUITE_RED_RULE, suiteRedIn } from "./suiteReport";

test("a SUITE RED line names the failing test files; prose is not read", () => {
  assert.deepEqual(suiteRedIn("done.\nSUITE RED: tests/compare_AC-10_test.py, `tests/compare_AC-11_test.py`\nUNDELIVERED: none"), {
    files: ["tests/compare_AC-10_test.py", "tests/compare_AC-11_test.py"],
  });
  assert.deepEqual(suiteRedIn("- **SUITE RED:** tests/a_test.py::test_x"), { files: ["tests/a_test.py"] });
  assert.deepEqual(suiteRedIn("SUITE RED:"), { files: [] }, "a red suite naming no file is still red");
  assert.equal(suiteRedIn("FINDING: With ./run_tests.sh, 12 tests in tests/ fail when the whole suite runs together"), undefined);
});

test("the closer's brief carries the rule", () => {
  const brief = closerBrief({
    subject: "TEP-1",
    round: 1,
    state: { green: false, score: 1, evidence: "red" },
    history: [],
    criteria: [],
    probeSources: [],
    footprint: [],
    worktree: "/tmp/x",
  });
  assert.ok(brief.includes(SUITE_RED_RULE));
});

function template(): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-suite-report-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
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
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "base"]);
  return { dir, base: execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
}

/** A template gate whose build is red when the gate judges the tree (its
 *  second build: the first prepares the tree for the checks), so the
 *  finisher runs and reports the whole suite red; the suite here answers
 *  as `suiteHere`. */
async function gate(suiteHere: { code: number; output: string }) {
  const st = new RunState(() => {});
  const { dir: worktree, base } = template();
  const suiteRan: string[] = [];
  let builds = 0;
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
      worker: async () => ({ ok: true, finalText: "SUITE RED: tests/compare_AC-10_test.py\nUNDELIVERED: none" }),
    },
    runOne: proved("./run_tests.sh <file>", true)!,
    suite: proved("./run_tests.sh", true)!,
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
    boundedExec: async (cmd: string) =>
      cmd === "npm run build" && ++builds === 2 ? { code: 1, output: "SyntaxError: app/main.py" } : { code: 0, output: "built" },
    suiteExec: async (cmd: string) => (suiteRan.push(cmd), suiteHere),
    state: st,
    sessionOf: () => undefined,
    worker: async () => ({ ok: true, finalText: "" }),
    machineAttention: () => 0,
    log: () => {},
    defect: () => {},
  } as never);
  return { out, suiteRan };
}

test("a suite an actor reported red is reproduced here, and the delivery is withheld while it is red", async () => {
  const { out, suiteRan } = await gate({ code: 1, output: "FAILED tests/compare_AC-10_test.py::test_x - assert 1 == 2\n1 failed in 0.1s" });
  assert.ok(suiteRan.includes("./run_tests.sh"), `the reported suite was run to reproduce it: ${suiteRan.join(" · ")}`);
  assert.ok(out.delivery?.withheld, `withheld: ${JSON.stringify(out.refusals)}`);
  assert.equal(out.delivery?.proofs.find((p) => p.label === "repo suite")?.verdict, "red");
});

test("a reported red suite that passes here does not withhold", async () => {
  const { out, suiteRan } = await gate({ code: 0, output: "30 passed in 1.0s" });
  assert.deepEqual(suiteRan, ["./run_tests.sh"], "the suite ran once, to answer the report");
  // The test tree has no branch to land, so only the suite's part is asked.
  assert.doesNotMatch(String(out.delivery?.withheld ?? ""), /standing checks are red/);
  assert.ok(!out.refusals.some((r) => /standing checks are red/.test(r)), out.refusals.join("\n"));
});
