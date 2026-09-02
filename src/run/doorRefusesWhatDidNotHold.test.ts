/**
 * A one-test command that was tried on a real test and failed refuses the
 * run at the door. It used to be carried in as if nothing had been tried,
 * and every check of the run then ended "not judged" for want of a runner.
 * A test runner the tree does not carry is installed first, once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setupRunTree } from "./setup";

function tree(): { base: string; wt: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-base-"));
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  return { base, wt };
}
const listing = "backend/app/api/tasks.py\nbackend/tests/test_tasks.py\n";

test("tried on a real test and failed: refused, naming the test and the reason", async () => {
  const { base, wt } = tree();
  const ran: string[] = [];
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    runOne: "cd backend && pytest <file>",
    exec: async (cmd, args) => (cmd === "git" && args.includes("ls-files") ? { code: 0, out: listing } : { code: 0, out: "" }),
    boundedExec: async (cmd) => {
      ran.push(cmd);
      if (/^command -v pytest/.test(cmd)) return { code: 0, output: "/usr/bin/pytest" };
      return { code: 4, output: "ImportError while loading conftest\nE   Field required [type=missing]" };
    },
    log: () => {},
  });
  assert.match(setup.refusal ?? "", /did not hold on backend\/tests\/test_tasks\.py/);
  assert.match(setup.refusal ?? "", /Field required/);
});

test("a missing test runner is installed before the command is tried", async () => {
  const { base, wt } = tree();
  const ran: string[] = [];
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    runOne: "cd backend && pytest <file>",
    exec: async (cmd, args) => (cmd === "git" && args.includes("ls-files") ? { code: 0, out: listing } : { code: 0, out: "" }),
    boundedExec: async (cmd) => {
      ran.push(cmd);
      if (/^command -v pytest/.test(cmd)) return { code: 1, output: "" };
      if (/pip install .*pytest/.test(cmd)) return { code: 0, output: "" };
      return { code: 0, output: "1 passed in 0.1s" };
    },
    log: () => {},
  });
  assert.equal(setup.refusal, undefined);
  assert.ok(ran.some((c) => /pip install .*pytest/.test(c)), "pytest was installed");
  assert.equal(String(setup.runOne), "cd backend && pytest <file>");
});

test("nothing to try it on: carried, not refused", async () => {
  const { base, wt } = tree();
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    runOne: "pytest <file>",
    exec: async (cmd, args) => (cmd === "git" && args.includes("ls-files") ? { code: 0, out: "app.py\n" } : { code: 0, out: "" }),
    boundedExec: async () => ({ code: 0, output: "" }),
    log: () => {},
  });
  assert.equal(setup.refusal, undefined);
});

test("the sample is a test, never __init__.py or conftest.py", async () => {
  const { base, wt } = tree();
  const tried: string[] = [];
  await setupRunTree({
    worktree: wt,
    repoRoot: base,
    runOne: "cd backend && pytest <file>",
    exec: async (cmd, args) =>
      cmd === "git" && args.includes("ls-files")
        ? { code: 0, out: "backend/tests/__init__.py\nbackend/tests/conftest.py\nbackend/tests/test_tasks.py\n" }
        : { code: 0, out: "" },
    boundedExec: async (cmd) => {
      if (/pytest /.test(cmd)) tried.push(cmd);
      return { code: 0, output: "1 passed" };
    },
    log: () => {},
  });
  assert.ok(tried.some((c) => /test_tasks\.py/.test(c)), tried.join(" | "));
  assert.ok(!tried.some((c) => /__init__|conftest/.test(c)), "never a fixture file");
});

test("a file a declared part owns is proved with the part's command, never the repository-wide one", async () => {
  const { base, wt } = tree();
  const tried: string[] = [];
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    runOne: "python -m pytest <file>",
    partCommands: { backend: { runOne: "set -a; . ./.env.test; set +a; pytest <file>" } },
    exec: async (cmd, args) => (cmd === "git" && args.includes("ls-files") ? { code: 0, out: listing } : { code: 0, out: "" }),
    boundedExec: async (cmd, cwd) => {
      if (/pytest/.test(cmd)) tried.push(`${cwd.endsWith("/backend") ? "backend" : "."}: ${cmd}`);
      return { code: 0, output: "1 passed" };
    },
    log: () => {},
  });
  assert.equal(setup.refusal, undefined);
  assert.ok(!tried.some((c) => c.startsWith(".: python -m pytest")), `the wide command was tried on a backend file: ${tried.join(" | ")}`);
  assert.ok(tried.some((c) => c.startsWith("backend: ")), "the part's own command was proved in its tree");
});
