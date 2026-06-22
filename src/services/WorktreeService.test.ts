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
  planWorktree,
  mcpWithBoardRoot,
  worktreeRetirable,
  retirePlan,
} from "./WorktreeService";
import * as path from "node:path";

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
    findSpecWorktree(entries, "5")?.path,
    "/home/u/repo-worktrees/SP-5",
  );
  // No false prefix match: SP-1 must not match SP-12.
  assert.equal(findSpecWorktree(entries, "1"), undefined);
  assert.equal(
    findSpecWorktree(entries, "12")?.path,
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

// ── Start Spec in Worktree: create-or-reuse + board-root inject (SP-tgpwbm AC7) ──

test("planWorktree REUSES an existing worktree for the Spec (no re-add → no throw)", () => {
  const existing = parseWorktreeList(
    [
      "worktree /home/u/repo",
      "branch refs/heads/main",
      "",
      "worktree /home/u/repo-worktrees/SP-5",
      "branch refs/heads/spec/SP-5",
      "",
    ].join("\n"),
  );
  const plan = planWorktree(existing, "/home/u/repo", "5");
  assert.equal(plan.reuse, true);
  assert.equal(plan.path, "/home/u/repo-worktrees/SP-5");
});

test("planWorktree computes a fresh sibling path when no worktree exists yet", () => {
  const existing = parseWorktreeList(
    ["worktree /home/u/repo", "branch refs/heads/main", ""].join("\n"),
  );
  const plan = planWorktree(existing, "/home/u/repo", "7");
  assert.equal(plan.reuse, false);
  assert.equal(plan.path, "/home/u/repo-worktrees/SP-7");
});

test("planWorktree honours an explicit baseDir for a fresh worktree", () => {
  const plan = planWorktree([], "/home/u/repo", "9", "/tmp/wts");
  assert.equal(plan.reuse, false);
  assert.equal(plan.path, "/tmp/wts/SP-9");
});

test("mcpWithBoardRoot injects THINKUBE_BOARD_ROOT into the kanban server env", () => {
  const mcp = {
    mcpServers: {
      "thinkube-kanban": {
        command: "node",
        args: ["server.js"],
        env: { THINKUBE_ROOTS: "/a:/b" },
      },
    },
  };
  const out = mcpWithBoardRoot(mcp, "/home/u/thinkube-tandem") as {
    mcpServers: { "thinkube-kanban": { env: Record<string, string> } };
  };
  const env = out.mcpServers["thinkube-kanban"].env;
  assert.equal(env.THINKUBE_BOARD_ROOT, "/home/u/thinkube-tandem");
  // Existing env is preserved, and the input is not mutated.
  assert.equal(env.THINKUBE_ROOTS, "/a:/b");
  assert.equal(
    (mcp.mcpServers["thinkube-kanban"].env as Record<string, string>)
      .THINKUBE_BOARD_ROOT,
    undefined,
  );
});

test("mcpWithBoardRoot creates the env object when the server has none", () => {
  const out = mcpWithBoardRoot(
    { mcpServers: { "thinkube-kanban": { command: "node" } } },
    "/board",
  ) as { mcpServers: { "thinkube-kanban": { env: Record<string, string> } } };
  assert.equal(
    out.mcpServers["thinkube-kanban"].env.THINKUBE_BOARD_ROOT,
    "/board",
  );
});

test("mcpWithBoardRoot is a no-op when the kanban server is absent", () => {
  const out = mcpWithBoardRoot({ mcpServers: { other: {} } }, "/board") as {
    mcpServers: Record<string, unknown>;
  };
  assert.deepEqual(out.mcpServers, { other: {} });
});

// ── worktreeRetirable (accept-land cleanup, TEP-tgqa78) ──────────────────────

test("worktreeRetirable: a clean worktree is retirable", () => {
  assert.equal(worktreeRetirable(""), true);
  assert.equal(worktreeRetirable("\n  \n"), true);
});

test("worktreeRetirable: dirty with only .mcp.json is retirable (machine-local)", () => {
  assert.equal(worktreeRetirable(" M .mcp.json"), true);
  assert.equal(worktreeRetirable("?? .mcp.json"), true);
});

test("worktreeRetirable: any other uncommitted path is NOT retirable", () => {
  assert.equal(worktreeRetirable(" M src/foo.ts"), false);
  // .mcp.json plus a real edit still refuses — only .mcp.json alone is ignorable.
  assert.equal(worktreeRetirable(" M .mcp.json\n M src/foo.ts"), false);
  assert.equal(worktreeRetirable("?? newfile.txt"), false);
});

test("worktreeRetirable: a quoted .mcp.json path (git special-char quoting) still matches", () => {
  assert.equal(worktreeRetirable('?? ".mcp.json"'), true);
});

// ── retirePlan (don't delete the session's own cwd) ──────────────────────────

test("retirePlan: cwd outside the worktree → retire", () => {
  assert.equal(retirePlan("/home/u/repo", "/home/u/wt/SP-1"), "retire");
});

test("retirePlan: cwd IS the worktree → defer", () => {
  assert.equal(retirePlan("/home/u/wt/SP-1", "/home/u/wt/SP-1"), "defer");
});

test("retirePlan: cwd inside the worktree → defer", () => {
  assert.equal(retirePlan("/home/u/wt/SP-1/src", "/home/u/wt/SP-1"), "defer");
});

test("retirePlan: a sibling whose path is a string-prefix is NOT inside → retire", () => {
  // `/home/u/wt/SP-12` must not count as inside `/home/u/wt/SP-1`.
  assert.equal(retirePlan("/home/u/wt/SP-12", "/home/u/wt/SP-1"), "retire");
});

test("retirePlan: trailing slashes don't change the verdict", () => {
  assert.equal(retirePlan("/home/u/wt/SP-1/", "/home/u/wt/SP-1"), "defer");
  assert.equal(path.sep, "/"); // sanity: POSIX separator in this env
});
