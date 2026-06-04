/**
 * Unit tests for the pure `git worktree list --porcelain` parser. Run via
 * `npm test`. No git/fs — just the text → entries projection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseWorktreeList,
  findSpecWorktree,
  parseGitdir,
} from "./WorktreeService";

test("parses the canonical worktree first, then linked worktrees", () => {
  const porcelain = [
    "worktree /home/u/repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /home/u/repo-worktrees/SP-5",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/spec/SP-5",
    "",
  ].join("\n");
  const entries = parseWorktreeList(porcelain);
  assert.equal(entries.length, 2);
  // First entry is always the canonical (main) checkout.
  assert.equal(entries[0].path, "/home/u/repo");
  assert.equal(entries[0].branch, "main");
  // refs/heads/ is stripped, nested branch names survive.
  assert.equal(entries[1].path, "/home/u/repo-worktrees/SP-5");
  assert.equal(entries[1].branch, "spec/SP-5");
  assert.equal(entries[1].head, "2222222222222222222222222222222222222222");
});

test("handles detached and bare worktrees without a branch", () => {
  const porcelain = [
    "worktree /home/u/repo",
    "HEAD 3333333333333333333333333333333333333333",
    "detached",
    "",
    "worktree /home/u/bare",
    "bare",
    "",
  ].join("\n");
  const entries = parseWorktreeList(porcelain);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].detached, true);
  assert.equal(entries[0].branch, undefined);
  assert.equal(entries[1].bare, true);
});

test("tolerates a trailing record with no terminating blank line", () => {
  const porcelain = [
    "worktree /home/u/repo",
    "HEAD 4444444444444444444444444444444444444444",
    "branch refs/heads/main",
  ].join("\n");
  const entries = parseWorktreeList(porcelain);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].branch, "main");
});

test("findSpecWorktree matches the spec/SP-{n} branch, or returns undefined", () => {
  const entries = parseWorktreeList(
    [
      "worktree /home/u/repo",
      "branch refs/heads/main",
      "",
      "worktree /home/u/repo-worktrees/SP-5",
      "branch refs/heads/spec/SP-5",
      "",
      "worktree /home/u/repo-worktrees/SP-12",
      "branch refs/heads/spec/SP-12",
      "",
    ].join("\n"),
  );
  assert.equal(
    findSpecWorktree(entries, 5)?.path,
    "/home/u/repo-worktrees/SP-5",
  );
  // No false prefix match: SP-1 must not match SP-12.
  assert.equal(findSpecWorktree(entries, 1), undefined);
  assert.equal(
    findSpecWorktree(entries, 12)?.path,
    "/home/u/repo-worktrees/SP-12",
  );
});

test("parseGitdir extracts the canonical repo + worktree name from a .git pointer", () => {
  const wt = parseGitdir("gitdir: /home/u/myrepo/.git/worktrees/SP-5\n");
  assert.deepEqual(wt, { canonicalRepo: "/home/u/myrepo", name: "SP-5" });
  // Windows-style backslashes are normalized.
  assert.deepEqual(
    parseGitdir("gitdir: C:\\dev\\myrepo\\.git\\worktrees\\SP-9"),
    { canonicalRepo: "C:/dev/myrepo", name: "SP-9" },
  );
});

test("parseGitdir returns undefined for non-worktree .git pointers", () => {
  // A submodule's gitdir points at .git/modules/, not /worktrees/.
  assert.equal(
    parseGitdir("gitdir: /home/u/myrepo/.git/modules/vendor/lib"),
    undefined,
  );
  // Junk / a normal repo (which has no .git *file* at all).
  assert.equal(parseGitdir("not a gitdir pointer"), undefined);
  assert.equal(parseGitdir(""), undefined);
});
