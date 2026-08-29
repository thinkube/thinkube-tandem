/**
 * What a run may borrow is learned from the repository, in any language.
 *
 * It used to be a list of names — node_modules, venv, Pods — which is a
 * list of the ecosystems somebody thought of. A project whose store is
 * called anything else matched nothing: it paid for a full install every
 * run, and every runner worktree was built with no dependencies at all, so
 * each check died with the tool own words and the failure read as a verdict
 * on the code. Silent, permanent, and invisible in every language but the
 * one the list was written for.
 *
 * What a repository IGNORES is what it does not author, and what it does
 * not author is what a run should not rebuild. That answer needs no list
 * and no memory, and the build proof right after is its guard.
 *
 * These drives use a Python project on purpose. Nothing here knows what
 * npm is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openTheDoor, setupRunTree } from "./setup";
import { proveSuite } from "./suiteCommand";
import type { Exec } from "./oracle";
import { ownershipOf, releaseBorrowed, removeOwned } from "./ownTree";

const exec: Exec = (cmd, args, cwd) =>
  new Promise((resolve) =>
    execFile(cmd, args as string[], { cwd }, (err, out, errOut) =>
      resolve({ code: err ? 1 : 0, out: `${out}${errOut}` }),
    ),
  );
const boundedExec = async (cmd: string, cwd: string): Promise<{ code: number | null; output: string }> =>
  new Promise((resolve) =>
    execFile("bash", ["-lc", cmd], { cwd }, (err, out, errOut) =>
      resolve({ code: err ? 1 : 0, output: `${out}${errOut}` }),
    ),
  );

/** A Python project: its dependency store is `.venv`, and its install
 *  command is a shell line that makes one. No JavaScript anywhere. */
function pythonProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "py-"));
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  fs.writeFileSync(path.join(root, "app.py"), "def add(a, b):\n    return a + b\n");
  fs.writeFileSync(path.join(root, "requirements.txt"), "# none\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".venv/\n__pycache__/\n");
  execFileSync("git", ["-C", root, "add", "."], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"],
    { stdio: "ignore" },
  );
  return root;
}

test("the door provisions a Python project by its own command", async () => {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });

  const ready = await setupRunTree({
    worktree: wt,
    repoRoot: root,
    // The repository's OWN install command. Nothing here is npm.
    provision: "mkdir -p .venv/lib && echo installed > .venv/lib/marker",
    prepare: "true",
    exec,
    boundedExec,
    log: () => {},
  });

  assert.ok(
    ready.provisioned.includes(".venv"),
    `every runner must be given it; got [${ready.provisioned.join(", ")}]`,
  );
});

/**
 * Dependency stores, in a language nothing here knows.
 *
 * A run may borrow ONLY what this repository's install command was watched
 * producing in an earlier run. It used to be the other way round — lend
 * everything the tree ignores minus what a build was seen making — and
 * that denylist lent `out` to a run, which compiled through the link into
 * the directory the extension is deployed from. On a first meeting nothing
 * is remembered, so nothing is lent: the run pays for one install and
 * watches what appears, which is how the answer is learned.
 */
test("a store is borrowed or installed, and nothing outside the run's tree is touched", async () => {
  {
  const root = pythonProject();
  fs.mkdirSync(path.join(root, ".venv", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, ".venv", "lib", "marker"), "from the checkout\n");
  const wt = path.join(os.tmpdir(), `py-wt2-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });

  const ready = await setupRunTree({
    worktree: wt,
    repoRoot: root,
    provision: "exit 9", // must NOT run: borrowing means not installing
    prepare: "true",
    // An earlier run watched the install produce this. Without the memory,
    // nothing would be lent and the install would run.
    dependencies: [".venv"],
    exec,
    boundedExec,
    log: () => {},
  });

  assert.equal(ready.refusal, undefined, "the install never ran, so it never failed");
  assert.ok(ready.provisioned.includes(".venv"));
  assert.equal(
    await ownershipOf(wt, path.join(wt, ".venv")),
    "borrowed",
    "it is a doorway into the checkout, not a copy",
  );
  }
  {
  const root = pythonProject();
  fs.mkdirSync(path.join(root, ".venv", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, ".venv", "lib", "precious"), "the person's own\n");
  const wt = path.join(os.tmpdir(), `py-wt3-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });
  // The tree carries a doorway into the checkout, as a borrow leaves it.
  fs.symlinkSync(path.join(root, ".venv"), path.join(wt, ".venv"));

  const freed = await releaseBorrowed(wt, [".venv"]);
  assert.deepEqual(freed, [".venv"], "the doorway is closed before any install");
  assert.ok(
    fs.existsSync(path.join(root, ".venv", "lib", "precious")),
    "and what was behind it is untouched",
  );
  assert.equal(fs.existsSync(path.join(wt, ".venv")), false, "the tree is ready to install into");
  }
  {
  const root = pythonProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "not-ours-"));
  fs.writeFileSync(path.join(outside, "keep"), "keep\n");

  const r = await removeOwned(root, outside);
  assert.equal(r.removed, "foreign");
  assert.match(r.refused ?? "", /outside this run's tree/);
  assert.ok(fs.existsSync(path.join(outside, "keep")), "nothing was destroyed");
  }
  {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt4-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });

  const ready = await setupRunTree({
    worktree: wt,
    repoRoot: root,
    provision: "mkdir -p .venv && echo x > .venv/marker",
    prepare: "true",
    exec,
    boundedExec,
    log: () => {},
  });
  assert.equal(
    await ownershipOf(wt, path.join(wt, ".venv")),
    "own",
    "it installed its own rather than inheriting the checkout's",
  );
  }
});




/**
 * Proving the whole-suite command before anything is judged by it.
 *
 * A runner that answers — green, or red in its own words — has run. A
 * repository's own tests failing is its business and the command still
 * holds. "Command not found" is not an answer, and judging by it told
 * people their standing checks were red when nothing had run at all.
 */
test("a suite command is kept when a runner answers, dropped when none does", async () => {
  {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt5-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });
  fs.writeFileSync(path.join(wt, "run_tests.sh"), "#!/bin/sh\necho '1 passed'\n");
  fs.chmodSync(path.join(wt, "run_tests.sh"), 0o755);

  const held = await proveSuite({ worktree: wt, boundedExec, log: () => {} }, "./run_tests.sh");
  assert.equal(held, "./run_tests.sh", "the repository's own way of running its suite");
  }
  {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt6-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });

  // What every non-npm repository was handed.
  const held = await proveSuite({ worktree: wt, boundedExec, log: () => {} }, "npm test");
  assert.equal(held, "", "command not found is not a verdict about the work");
  }
  {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt7-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });
  fs.writeFileSync(path.join(wt, "red.sh"), "#!/bin/sh\necho '2 failed'\nexit 1\n");
  fs.chmodSync(path.join(wt, "red.sh"), 0o755);

  const held = await proveSuite({ worktree: wt, boundedExec, log: () => {} }, "./red.sh");
  assert.equal(held, "./red.sh", "a red suite on the base is the base's business, not a bad command");
  }
});



/**
 * The run must know how the repository runs its whole suite.
 *
 * The gate's last judgement IS that command's verdict on the delivered
 * tree. Four of the five commands a run needs are read from the repository
 * itself; this one was only ever a caller's setting, and when the setting
 * was removed the value became "". It was carried politely through five
 * hand-offs and executed at the final step of a seventy-minute run: every
 * unit done, sixty-one criteria assessed, and then `execFile("")`.
 */
function door(root: string, wt: string, extra: Record<string, unknown> = {}) {
  return openTheDoor({
    worktree: wt,
    repoRoot: root,
    tep: "TEP-1",
    told: { provision: "true", prepare: "true", ...extra },
    exec,
    boundedExec,
    log: () => {},
    defect: () => {},
    resumed: false,
    halted: () => false,
  });
}

/**
 * The run must know how this repository runs its whole suite.
 *
 * The closing gate's last judgement IS that command's verdict. Four of the
 * five commands a run needs are read from the repository; this one was
 * only ever a caller's setting, and when the setting went away the value
 * became "" — carried through five hand-offs and executed at the final
 * step of a seventy-minute run.
 */
test("the door asks for a suite command, and refuses the run without one", async () => {
  {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt8-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });
  fs.writeFileSync(path.join(wt, "all.sh"), "#!/bin/sh\necho '3 passed'\n");
  fs.chmodSync(path.join(wt, "all.sh"), 0o755);

  let asked = "";
  const ready = await door(root, wt, {
    resetup: async (evidence: string) => {
      asked = evidence;
      return { provision: "true", prepare: "true", suite: "./all.sh" };
    },
  });

  assert.match(asked, /WHOLE suite/, "the repository is asked, in the same words as the other four");
  assert.equal(ready.refusal, undefined);
  assert.equal(ready.suite, "./all.sh", "and the answer is proved before it is trusted");
  }
  {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt9-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });

  // Nobody knows, and the repository cannot say.
  const ready = await door(root, wt, { resetup: async () => ({ provision: "true", prepare: "true" }) });

  assert.match(
    ready.refusal ?? "",
    /whole suite/,
    "refused in the first minute, by name — not executed as an empty command in the last",
  );
  }
  {
  const root = pythonProject();
  const wt = path.join(os.tmpdir(), `py-wt10-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });

  const ready = await door(root, wt, {
    // What every non-npm repository was handed.
    resetup: async () => ({ provision: "true", prepare: "true", suite: "npm test" }),
  });

  assert.match(ready.refusal ?? "", /whole suite/, "command not found is not a suite");
  }
});

/**
 * The allowlist is the whole rule: nothing remembered, nothing lent.
 *
 * And what a BUILD makes is never on the list, however it got into the
 * checkout — `out` was lent under the old subtraction rule, and the run
 * compiled through the link into the directory the extension deploys from.
 */
test("a first meeting lends nothing, and build output is never lent", async () => {
  const root = pythonProject();
  // The checkout holds both a dependency store and build output.
  fs.mkdirSync(path.join(root, ".venv", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "app.bin"), "built\n");
  fs.appendFileSync(path.join(root, ".gitignore"), "dist/\n");
  const wt = path.join(os.tmpdir(), `py-wt-lend-${Date.now()}`);
  execFileSync("git", ["-C", root, "worktree", "add", "-q", wt], { stdio: "ignore" });

  let installed = false;
  const ready = await setupRunTree({
    worktree: wt,
    repoRoot: root,
    provision: "mkdir -p .venv/lib && echo mine > .venv/lib/marker",
    prepare: "true",
    // No `dependencies`: this repository has never been installed here.
    exec,
    boundedExec: async (cmd, cwd) => {
      if (cmd.startsWith("mkdir")) installed = true;
      return boundedExec(cmd, cwd);
    },
    log: () => {},
  });

  assert.equal(installed, true, "nothing remembered, so the install runs and is watched");
  assert.equal(
    fs.lstatSync(path.join(wt, ".venv")).isSymbolicLink(),
    false,
    "what it made is the run's own, not a doorway into the checkout",
  );
  assert.equal(fs.existsSync(path.join(wt, "dist")), false, "build output is never lent");
  assert.ok(ready.provisioned.includes(".venv"), "and the watched produce is reported for remembering");
});
