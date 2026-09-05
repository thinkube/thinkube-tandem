/**
 * The hand-over is the one act that lands work: the branch merges here,
 * the result is pushed, and nothing is pushed before that — a worker's
 * tree cannot push at all. Saying no afterwards takes it back out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { foreignSince, landDelivery, revertDelivery, sealWorktree, type GitExec } from "./land";

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
  assert.equal((await git(root, "rev-parse", "--verify", "--quiet", "tandem/x/TEP-1")).code, 1, "the branch goes with the merge: a repair starts from the project");
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

test("main that moved on the remote is brought in first, and the push is plain", async () => {
  const { origin, root } = await repo();
  await branchWith(root, "tandem/x/TEP-6", "b.txt", "two\n");
  // The pipeline commits to main on the remote, as it does after every build.
  const other = path.join(path.dirname(root), "other");
  await exec("git", ["clone", "-q", origin, other], root);
  await git(other, "config", "user.email", "p@p");
  await git(other, "config", "user.name", "pipeline");
  fs.writeFileSync(path.join(other, "k8s.yaml"), "image: 1\n");
  await git(other, "add", "k8s.yaml");
  await git(other, "commit", "-q", "-m", "build: automatic update");
  await git(other, "push", "-q", "origin", "main");
  const r = await landDelivery({ repoRoot: root, branch: "tandem/x/TEP-6", tep: "TEP-6", exec });
  assert.equal(r.merged, true);
  assert.ok(fs.existsSync(path.join(root, "k8s.yaml")), "the remote's commit is here");
  assert.ok(fs.existsSync(path.join(root, "b.txt")), "and so is the work");
  assert.equal((await exec("git", ["--git-dir", origin, "rev-parse", "main"], root)).out.trim(), r.head, "pushed");
});

test("a landing refused at the push carries on from the merge already made", async () => {
  const { origin, root } = await repo();
  await branchWith(root, "tandem/x/TEP-7", "b.txt", "two\n");
  // The merge was made here, and the remote had moved, so the push was refused.
  await git(root, "merge", "--no-ff", "--no-edit", "-m", "tandem: accept TEP-7", "tandem/x/TEP-7");
  const other = path.join(path.dirname(root), "other");
  await exec("git", ["clone", "-q", origin, other], root);
  await git(other, "config", "user.email", "p@p");
  await git(other, "config", "user.name", "pipeline");
  fs.writeFileSync(path.join(other, "k8s.yaml"), "image: 1\n");
  await git(other, "add", "k8s.yaml");
  await git(other, "commit", "-q", "-m", "build: automatic update");
  await git(other, "push", "-q", "origin", "main");
  assert.equal((await git(root, "push", "-q", "origin", "HEAD")).code, 1, "the plain push is refused");
  const r = await landDelivery({ repoRoot: root, branch: "tandem/x/TEP-7", tep: "TEP-7", exec });
  assert.equal(r.merged, true);
  assert.equal((await exec("git", ["--git-dir", origin, "rev-parse", "main"], root)).out.trim(), r.head, "pushed this time");
  assert.equal((await git(root, "rev-parse", "--verify", "--quiet", "tandem/x/TEP-7")).code, 1, "and the branch is gone");
});

test("saying no takes the work back out of the project and pushes that", async () => {
  const { origin, root } = await repo();
  await branchWith(root, "tandem/x/TEP-9", "b.txt", "two\n");
  const landed = await landDelivery({ repoRoot: root, branch: "tandem/x/TEP-9", tep: "TEP-9", exec });
  assert.ok(fs.existsSync(path.join(root, "b.txt")), "the work went in");
  const back = await revertDelivery({ repoRoot: root, head: landed.head, tep: "TEP-9", exec });
  assert.equal(back.ok, true, back.why);
  assert.equal(fs.existsSync(path.join(root, "b.txt")), false, "and it is out again");
  const remoteHead = (await exec("git", ["--git-dir", origin, "rev-parse", "main"], root)).out.trim();
  const here = (await git(root, "rev-parse", "HEAD")).out.trim();
  assert.equal(remoteHead, here, "the platform is told, so it builds the project as it was");
  const said = (await git(root, "log", "-1", "--format=%s")).out.trim();
  assert.equal(
    said,
    `tandem: roll back TEP-9 (${landed.head.slice(0, 8)})`,
    "and the history says what happened, and to which merge",
  );
});

test("a rollback already made is not made twice", async () => {
  const { root } = await repo();
  await branchWith(root, "tandem/x/TEP-10", "b.txt", "two\n");
  const landed = await landDelivery({ repoRoot: root, branch: "tandem/x/TEP-10", tep: "TEP-10", exec });
  assert.equal((await revertDelivery({ repoRoot: root, head: landed.head, tep: "TEP-10", exec })).ok, true);
  const before = (await git(root, "rev-parse", "HEAD")).out.trim();
  assert.equal((await revertDelivery({ repoRoot: root, head: landed.head, tep: "TEP-10", exec })).ok, true);
  assert.equal((await git(root, "rev-parse", "HEAD")).out.trim(), before, "nothing moved");
});

test("a merge this repository does not have cannot be rolled back, and says so", async () => {
  const { root } = await repo();
  const back = await revertDelivery({ repoRoot: root, head: "0".repeat(40), tep: "TEP-11", exec });
  assert.equal(back.ok, false);
  assert.match(back.why ?? "", /not in this repository/);
});

test("what sits on top of a merge is ours or it is not: tandem's own commits and the platform's image tags are ours", async () => {
  const { root } = await repo();
  await branchWith(root, "tandem/x/TEP-12", "b.txt", "two\n");
  const first = await landDelivery({ repoRoot: root, branch: "tandem/x/TEP-12", tep: "TEP-12", exec });

  // The platform commits an image tag after every build.
  fs.mkdirSync(path.join(root, "k8s"), { recursive: true });
  fs.writeFileSync(path.join(root, "k8s/kustomization.yaml"), "images:\n  - newTag: abc\n");
  await git(root, "add", "k8s/kustomization.yaml");
  await git(root, "commit", "-q", "-m", "build: automatic image update");
  // And the run repaired what the platform refused, and pushed again.
  fs.writeFileSync(path.join(root, "b.txt"), "two, fixed\n");
  await git(root, "add", "b.txt");
  await git(root, "commit", "-q", "-m", "tandem: TEP-12 — what the platform refused (attempt 1)");

  assert.deepEqual(
    await foreignSince({ repoRoot: root, head: first.head, ours: [first.head], exec }),
    [],
    "neither of those is somebody else's work",
  );

  // A person's own commit is.
  fs.writeFileSync(path.join(root, "a.txt"), "edited by hand\n");
  await git(root, "add", "a.txt");
  await git(root, "commit", "-q", "-m", "my own fix");
  const foreign = await foreignSince({ repoRoot: root, head: first.head, ours: [first.head], exec });
  assert.equal(foreign.length, 1, JSON.stringify(foreign));
  assert.equal(foreign[0].subject, "my own fix", "and it is named, so nothing takes it out silently");
});
