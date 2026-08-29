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
import { setupRunTree } from "./setup";
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

test("a store the checkout already has is borrowed, and nothing is installed", async () => {
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
});

test("installing never reaches through a borrowed store into the lender", async () => {
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
});

test("a run never deletes what it does not own", async () => {
  const root = pythonProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "not-ours-"));
  fs.writeFileSync(path.join(outside, "keep"), "keep\n");

  const r = await removeOwned(root, outside);
  assert.equal(r.removed, "foreign");
  assert.match(r.refused ?? "", /outside this run's tree/);
  assert.ok(fs.existsSync(path.join(outside, "keep")), "nothing was destroyed");
});

test("a store the checkout does not have is installed, not borrowed", async () => {
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
});
