/**
 * SP-17/1: a (re)dispatched Spec must never run against a STALE base. `WorktreeService.create`
 * brings a reused / re-added spec worktree onto the current base branch before provisioning —
 * fast-forwarding when the branch holds no local commits, replaying un-accepted committed work when
 * it does, and HALTING (throw) only on a real rebase conflict. Real git fixtures — no mocks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { WorktreeService } from "./WorktreeService";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    stdio: "pipe",
  }).toString();
}

function initRepo(seed: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tk-stale-base-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  for (const [rel, body] of Object.entries(seed)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "seed");
  return repo;
}

/** Commit a file onto the canonical repo's main (advancing the base under a stale worktree). */
function advanceMain(repo: string, rel: string, body: string): void {
  fs.writeFileSync(path.join(repo, rel), body);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `main:${rel}`);
}

test("reused worktree with NO local commits is fast-forwarded onto the advanced base", async () => {
  const repo = initRepo({ "a.ts": "1\n" });
  const svc = new WorktreeService();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-stale-trees-"));

  const wt = await svc.create(repo, "1", wtRoot); // spec/SP-1 cut from main@seed
  advanceMain(repo, "b.ts", "2\n"); // main is now 1 commit ahead of the worktree
  await svc.create(repo, "1", wtRoot); // reuse → must refresh

  // The base's new file is present and the worktree HEAD equals main (behind 0).
  assert.equal(fs.existsSync(path.join(wt, "b.ts")), true);
  assert.equal(
    git(wt, "rev-parse", "HEAD").trim(),
    git(repo, "rev-parse", "main").trim(),
  );

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});

test("un-accepted committed work on the branch is REBASED onto the advanced base (not lost)", async () => {
  const repo = initRepo({ "a.ts": "1\n" });
  const svc = new WorktreeService();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-stale-trees2-"));

  const wt = await svc.create(repo, "1", wtRoot);
  // A prior Done slice: a commit on the spec branch, not yet accepted into main.
  fs.writeFileSync(path.join(wt, "feature.ts"), "feat\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "slice-1");
  advanceMain(repo, "b.ts", "2\n"); // non-conflicting base advance

  await svc.create(repo, "1", wtRoot); // reuse → rebase the branch onto main

  // Both the branch's own work AND the base's advance are present; nothing is behind.
  assert.equal(fs.existsSync(path.join(wt, "feature.ts")), true);
  assert.equal(fs.existsSync(path.join(wt, "b.ts")), true);
  assert.equal(git(wt, "rev-list", "--count", "HEAD..main").trim(), "0");
  assert.equal(git(wt, "rev-list", "--count", "main..HEAD").trim(), "1");

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});

test("disposable uncommitted worker output is discarded on refresh (never graded as this run)", async () => {
  const repo = initRepo({ "a.ts": "1\n" });
  const svc = new WorktreeService();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-stale-trees3-"));

  const wt = await svc.create(repo, "1", wtRoot);
  // A prior run left an uncommitted new file and a modification.
  fs.writeFileSync(path.join(wt, "leftover.ts"), "stale\n");
  fs.writeFileSync(path.join(wt, "a.ts"), "MODIFIED\n");
  advanceMain(repo, "b.ts", "2\n");

  await svc.create(repo, "1", wtRoot);

  assert.equal(fs.existsSync(path.join(wt, "leftover.ts")), false); // untracked leftover cleaned
  assert.equal(fs.readFileSync(path.join(wt, "a.ts"), "utf8"), "1\n"); // modification reverted
  assert.equal(fs.existsSync(path.join(wt, "b.ts")), true); // now on the current base

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});

test("a real rebase conflict HALTS the dispatch (throws) rather than run a stale base", async () => {
  const repo = initRepo({ "f.ts": "base\n" });
  const svc = new WorktreeService();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tk-stale-trees4-"));

  const wt = await svc.create(repo, "1", wtRoot);
  // The branch and main both edit f.ts, divergently → the rebase cannot apply cleanly.
  fs.writeFileSync(path.join(wt, "f.ts"), "branch change\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "branch-edit");
  advanceMain(repo, "f.ts", "main change\n");

  await assert.rejects(
    () => svc.create(repo, "1", wtRoot),
    /stale base is never run/,
  );
  // The failed rebase was ABORTED, not left mid-flight: HEAD is back on the branch tip
  // (its own commit intact), and the tree is not in a conflicted rebase state.
  assert.equal(git(wt, "rev-parse", "--abbrev-ref", "HEAD").trim(), "spec/SP-1");
  assert.match(git(wt, "log", "-1", "--format=%s").trim(), /branch-edit/);
  assert.doesNotMatch(git(wt, "status").toLowerCase(), /rebase in progress/);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});
