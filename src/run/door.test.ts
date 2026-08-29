/**
 * The door: what a run proves about a repository before any worker runs,
 * what it borrows from the checkout beside it, and what it must never let
 * reach a commit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { setupRunTree } from "./setup";
import { factsOf, rememberFacts } from "./facts";

/**
 * Borrowing instead of installing.
 *
 * A run that installs again costs minutes and, on a small machine, dies
 * during an install it did not need. Dependencies may be shared; build
 * output may not — output is the work being judged, and lending it made a
 * run compile through a doorway into the other tree and grade that tree.
 */
test("the door borrows dependency stores from the checkout, and nothing else", async () => {
  {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-base-"));
  fs.mkdirSync(path.join(base, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(base, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  const ran: string[] = [];
  const said: string[] = [];
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    provision: "npm ci",
    // An earlier run watched the install produce this — the only reason
    // anything may be lent.
    dependencies: ["node_modules"],
    exec: async (cmd, args, cwd) =>
      cmd === "git" && args[2] === "status"
        ? { code: 0, out: cwd === base ? "!! node_modules/\n" : "" }
        : { code: 0, out: "" },
    boundedExec: async (cmd) => {
      ran.push(cmd);
      return { code: 0, output: "" };
    },
    log: (l) => said.push(l),
  });

  assert.deepEqual(ran, [], "the install never ran");
  assert.deepEqual(setup.provisioned, ["node_modules"], "and the run still knows what it has");
  assert.ok(fs.existsSync(path.join(wt, "node_modules", "dep", "index.js")), "the dependency is reachable in the worktree");
  assert.ok(said.some((l) => /borrowing the checkout's node_modules/.test(l)));
  }
  {
  // Run 2 of the acceptance died here: no install command was known, so
  // nothing was borrowed and nothing was installed, and the suite failed
  // before its first test on a tree missing its dependencies.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-base-"));
  fs.mkdirSync(path.join(base, "webview", "map", "node_modules", "vite"), { recursive: true });
  fs.writeFileSync(path.join(base, "webview", "map", "node_modules", "vite", "index.js"), "");
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    dependencies: ["webview/map/node_modules"],
    exec: async (cmd, args, cwd) =>
      cmd === "git" && args[2] === "status"
        ? { code: 0, out: cwd === base ? "!! webview/map/node_modules/\n" : "" }
        : { code: 0, out: "" },
    boundedExec: async () => ({ code: 0, output: "" }),
    log: () => {},
  });
  assert.deepEqual(setup.provisioned, ["webview/map/node_modules"]);
  assert.ok(
    fs.existsSync(path.join(wt, "webview", "map", "node_modules", "vite", "index.js")),
    "a nested dependency directory is lent too",
  );
  }
  {
  // Run 4 judged the wrong tree: the borrow lent out-test/ as a symlink, so
  // the worktree's suite compiled through it INTO the base checkout and ran
  // the base's code. Seven reds against work that was finished.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-base-"));
  for (const d of ["node_modules", "out-test", "out", "media", "coverage"])
    fs.mkdirSync(path.join(base, d), { recursive: true });
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    dependencies: ["node_modules"],
    exec: async (cmd, args, cwd) =>
      cmd === "git" && args[2] === "status"
        ? {
            code: 0,
            out:
              cwd === base
                ? "!! node_modules/\n!! out-test/\n!! out/\n!! media/\n!! coverage/\n!! thinkube-tandem-2.0.144.vsix\n"
                : "",
          }
        : { code: 0, out: "" },
    boundedExec: async () => ({ code: 0, output: "" }),
    log: () => {},
  });
  assert.deepEqual(setup.provisioned, ["node_modules"], "only the dependency store crossed");
  for (const d of ["out-test", "out", "media", "coverage", "thinkube-tandem-2.0.144.vsix"])
    assert.ok(!fs.existsSync(path.join(wt, d)), `${d} was lent — the run would judge the base's tree`);
  }
});



test("what the door lends can never be committed, even by add -A", async () => {
  // Run 4's withheld commit ran `git add -A` and committed four borrowed
  // symlinks onto the branch — the repository's own `node_modules/` ignore
  // matches a directory, not a symlink. After that, every fresh checkout of
  // the branch recreated links into the base checkout and the suite judged
  // the wrong tree, run after run.
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-real-base-"));
  execFileSync("git", ["init", "-q", base]);
  g(base, "config", "user.email", "t@t");
  g(base, "config", "user.name", "t");
  fs.writeFileSync(path.join(base, "a.txt"), "a\n");
  fs.writeFileSync(path.join(base, ".gitignore"), "node_modules/\n");
  fs.mkdirSync(path.join(base, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(base, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  g(base, "add", "a.txt", ".gitignore");
  g(base, "commit", "-qm", "seed");
  const wt = path.join(base, "..", `${path.basename(base)}-wt`);
  g(base, "worktree", "add", "-q", "-b", "run", wt);

  const exec = async (cmd: string, args: string[], cwd: string) => {
    try {
      return { code: 0, out: execFileSync(cmd, ["-C", cwd, ...args.slice(2)], { encoding: "utf8" }) };
    } catch (err) {
      return { code: 1, out: String((err as { stdout?: string }).stdout ?? "") };
    }
  };
  await setupRunTree({ worktree: wt, repoRoot: base, dependencies: ["node_modules"], exec: exec as never, boundedExec: async () => ({ code: 0, output: "" }), log: () => {} });

  assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "the dependency store was lent as a link");
  g(wt, "add", "-A", ".");
  assert.equal(
    g(wt, "status", "--porcelain").split("\n").filter((l: string) => l.includes("node_modules")).join(""),
    "",
    "and add -A cannot stage it",
  );
});

test("the four facts about a repository are kept in the repository", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-facts-"));
  assert.equal(factsOf(repo), undefined, "a repository never run against tells nothing");

  rememberFacts(repo, { provision: "npm ci", prepare: "npm run build", runOne: "node --test <file>" }, "2026-08-22T20:00:00Z");
  const told = factsOf(repo);
  assert.equal(told?.provision, "npm ci");
  assert.equal(told?.runOne, "node --test <file>");
  assert.equal(told?.provenAt, "2026-08-22T20:00:00Z", "and says when it was proved");

  // A repository that cannot be written to still runs: a file where the
  // directory would go makes the write impossible, and nothing throws.
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-blocked-"));
  fs.writeFileSync(path.join(blocked, ".tandem"), "not a directory\n");
  assert.doesNotThrow(() => rememberFacts(blocked, { provision: "", prepare: "", runOne: "" }, "now"));
  assert.equal(factsOf(blocked), undefined, "and it simply asks again next time");
});

test("the door says when it runs with no facts at all", async () => {
  // Every check of one run failed for a single reason nobody was told: the
  // repository reading had returned nothing, 'nothing needed' was recorded
  // as proven, and the checks ran on an unbuilt tree.
  const said: string[] = [];
  await setupRunTree({
    worktree: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-")),
    exec: async () => ({ code: 0, out: "" }),
    boundedExec: async () => ({ code: 0, output: "" }),
    log: (l) => said.push(l),
  });
  assert.ok(said.some((l) => /no setup facts for this repository/.test(l)), said.join("\n"));
});
