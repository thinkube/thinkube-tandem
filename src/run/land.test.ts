/**
 * Accept is the one act that lands work: the branch merges here, the
 * result is pushed, and nothing is pushed before that — a worker's tree
 * cannot push at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { landDelivery, sealWorktree, type GitExec } from "./land";

const exec: GitExec = (cmd, args, cwd) =>
  new Promise((resolve) =>
    execFile(cmd, args, { cwd, encoding: "utf8" }, (err, stdout, stderr) =>
      resolve({ code: err ? 1 : 0, out: `${stdout ?? ""}${stderr ?? ""}` }),
    ),
  );
const git = (cwd: string, ...args: string[]) => exec("git", ["-C", cwd, ...args], cwd);

/** A bare origin and a checkout of it on main with one commit. */
async function repo(): Promise<{ origin: string; root: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-land-"));
  const origin = path.join(dir, "origin.git");
  const root = path.join(dir, "checkout");
  await exec("git", ["init", "--bare", "-b", "main", origin], dir);
  await exec("git", ["clone", "-q", origin, root], dir);
  await git(root, "config", "user.email", "t@t");
  await git(root, "config", "user.name", "t");
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  await git(root, "add", "a.txt");
  await git(root, "commit", "-q", "-m", "base");
  await git(root, "push", "-q", "-u", "origin", "main");
  return { origin, root };
}

async function branchWith(root: string, branch: string, file: string, text: string): Promise<void> {
  await git(root, "checkout", "-q", "-b", branch);
  fs.writeFileSync(path.join(root, file), text);
  await git(root, "add", file);
  await git(root, "commit", "-q", "-m", `work on ${branch}`);
  await git(root, "checkout", "-q", "main");
}

test("accepting merges the branch here, pushes the result, and lets the branch go", async () => {
  const { origin, root } = await repo();
  await branchWith(root, "tandem/x/TEP-1", "b.txt", "two\n");
  const r = await landDelivery({ repoRoot: root, branch: "tandem/x/TEP-1", tep: "TEP-1", exec });
  assert.equal(r.merged, true);
  assert.ok(fs.existsSync(path.join(root, "b.txt")), "the work is on the checkout's branch");
  const remoteHead = (await exec("git", ["--git-dir", origin, "rev-parse", "main"], root)).out.trim();
  assert.equal(remoteHead, r.head, "and pushed");
  assert.equal((await git(root, "rev-parse", "--verify", "--quiet", "tandem/x/TEP-1")).code, 1, "the branch is gone");
});

test("an unrelated local change or an untracked file is no obstacle to landing", async () => {
  const { root } = await repo();
  await branchWith(root, "tandem/x/TEP-2", "b.txt", "two\n");
  fs.writeFileSync(path.join(root, "a.txt"), "edited by hand\n");
  fs.mkdirSync(path.join(root, ".tandem"));
  fs.writeFileSync(path.join(root, ".tandem/setup.json"), "{}");
  const r = await landDelivery({ repoRoot: root, branch: "tandem/x/TEP-2", tep: "TEP-2", exec });
  assert.equal(r.merged, true);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "edited by hand\n", "the person's change is untouched");
  assert.ok(fs.existsSync(path.join(root, "b.txt")), "and the work landed");
});

test("a local change to a file the delivery also changes is refused in git's words, and nothing moves", async () => {
  const { root } = await repo();
  await branchWith(root, "tandem/x/TEP-5", "a.txt", "theirs\n");
  fs.writeFileSync(path.join(root, "a.txt"), "edited by hand\n");
  await assert.rejects(
    landDelivery({ repoRoot: root, branch: "tandem/x/TEP-5", tep: "TEP-5", exec }),
    /uncommitted changes in files this delivery also changes: a\.txt/,
  );
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "edited by hand\n", "untouched");
  assert.equal((await git(root, "rev-parse", "--verify", "--quiet", "tandem/x/TEP-5")).code, 0, "the branch stays");
});

test("a conflicting merge is undone and refused with the file named", async () => {
  const { root } = await repo();
  await branchWith(root, "tandem/x/TEP-3", "a.txt", "theirs\n");
  fs.writeFileSync(path.join(root, "a.txt"), "mine\n");
  await git(root, "commit", "-q", "-am", "moved on main");
  await assert.rejects(landDelivery({ repoRoot: root, branch: "tandem/x/TEP-3", tep: "TEP-3", exec }), /conflicts .*a\.txt/);
  assert.equal((await git(root, "status", "--porcelain")).out.trim(), "", "the checkout is clean again");
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "mine\n");
});

test("a sealed worktree cannot push, and the checkout still can", async () => {
  const { root } = await repo();
  const wt = path.join(path.dirname(root), "wt");
  await git(root, "worktree", "add", "-q", "-b", "tandem/x/TEP-4", wt);
  await sealWorktree(root, wt, exec);
  fs.writeFileSync(path.join(wt, "c.txt"), "three\n");
  await git(wt, "add", "c.txt");
  await git(wt, "commit", "-q", "-m", "worker");
  const push = await git(wt, "push", "-u", "origin", "tandem/x/TEP-4");
  assert.equal(push.code, 1, "refused");
  assert.match(push.out, /does not appear to be a git repository|no-push/, push.out);
  assert.equal((await git(wt, "fetch", "-q", "origin")).code, 0, "fetching still works");
  fs.writeFileSync(path.join(root, "d.txt"), "four\n");
  await git(root, "add", "d.txt");
  await git(root, "commit", "-q", "-m", "person");
  assert.equal((await git(root, "push", "-q", "origin", "main")).code, 0, "the person's checkout pushes as before");
});
