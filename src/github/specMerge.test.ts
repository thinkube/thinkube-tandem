import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeSpecPr, specBranch, PrOps } from "./specMerge";

/**
 * A PrOps with safe defaults — no open PR, nothing ahead of main, no-op open/merge.
 * The defaults model a genuine straight-to-main Spec; override per test.
 */
function ops(over: Partial<PrOps> = {}): PrOps {
  return {
    openPrCount: async () => 0,
    unmergedCommits: async () => 0,
    openPr: async () => {},
    merge: async () => "",
    ...over,
  };
}

test("specBranch formats the one-branch-per-Spec name", () => {
  assert.equal(specBranch("tg8dsb"), "spec/SP-tg8dsb");
});

test("no PR and nothing ahead of main → no-pr, and neither openPr nor merge run", async () => {
  let openCalled = false;
  let mergeCalled = false;
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 0,
      unmergedCommits: async () => 0,
      openPr: async () => {
        openCalled = true;
      },
      merge: async () => {
        mergeCalled = true;
        return "should not happen";
      },
    }),
  );
  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: false,
    reason: "no-pr",
  });
  assert.equal(openCalled, false);
  assert.equal(mergeCalled, false);
});

test("an open PR → merges and returns merged:true opened:false, without opening a PR", async () => {
  let openCalled = false;
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 1,
      openPr: async () => {
        openCalled = true;
      },
      merge: async () => "Merged PR #7",
    }),
  );
  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    opened: false,
    output: "Merged PR #7",
  });
  assert.equal(openCalled, false, "an existing PR must not be re-opened");
});

test("no PR but the branch is ahead of main → opens the PR, then merges (the SP-th1jtj fix)", async () => {
  // The regression this guards: a branch-ahead Spec whose PR was never created must
  // still land — not be dropped as a benign no-op.
  let opened: string | null = null;
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 0,
      unmergedCommits: async () => 3, // real commits ahead of main
      openPr: async (branch) => {
        opened = branch;
      },
      merge: async () => "Merged PR #8",
    }),
  );
  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    opened: true,
    output: "Merged PR #8",
  });
  assert.equal(
    opened,
    "spec/SP-tg8dsb",
    "the PR must be opened for the ahead branch",
  );
});

test("no PR, branch ahead, but remote branch ABSENT (never pushed) → lands it, not mis-read as already-merged (#29)", async () => {
  // The strand bug: the orchestrator commits the Spec branch locally WITHOUT pushing,
  // so on the first accept the remote branch doesn't exist yet. The old code read that
  // absence as "already merged + deleted" and retired the branch, stranding the only
  // copy of the commit. The ahead-count must win: there is unmerged work → push + open
  // PR + merge — never alreadyMerged.
  let opened: string | null = null;
  let mergeCalled = false;
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 0,
      branchExists: async () => false, // never pushed — remote branch absent
      unmergedCommits: async () => 1, // but there IS unmerged work
      openPr: async (branch) => {
        opened = branch;
      },
      merge: async () => {
        mergeCalled = true;
        return "Merged PR #9";
      },
    }),
  );
  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    opened: true,
    output: "Merged PR #9",
  });
  assert.equal(
    opened,
    "spec/SP-tg8dsb",
    "an ahead branch must be pushed + opened, never retired as already-merged",
  );
  assert.equal(mergeCalled, true);
});

test("no PR, nothing ahead, remote branch GONE → already-merged idempotent re-accept (preserved)", async () => {
  // The legitimate case the branchExists probe exists for: a prior accept already
  // merged and deleted the branch, so nothing is ahead of main AND the remote branch is
  // gone. That stays an already-merged success so the dispatch retires any zombie
  // worktree — the #29 fix must not regress it.
  let openCalled = false;
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 0,
      unmergedCommits: async () => 0, // provably already in main
      branchExists: async () => false, // and the branch was deleted on merge
      openPr: async () => {
        openCalled = true;
      },
    }),
  );
  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    opened: false,
    output: "",
    alreadyMerged: true,
  });
  assert.equal(openCalled, false, "an already-merged Spec must not re-open a PR");
});

test("ahead branch whose openPr fails (rejected push / gh) → throws, not silently dropped", async () => {
  let mergeCalled = false;
  await assert.rejects(
    mergeSpecPr(
      "tg8dsb",
      "/repo",
      ops({
        openPrCount: async () => 0,
        unmergedCommits: async () => 2,
        openPr: async () => {
          throw new Error("git push spec/SP-tg8dsb failed: remote rejected");
        },
        merge: async () => {
          mergeCalled = true;
          return "";
        },
      }),
    ),
    /git push spec\/SP-tg8dsb failed: remote rejected/,
  );
  assert.equal(
    mergeCalled,
    false,
    "merge must not run when opening the PR failed",
  );
});

test("gh missing/unauthenticated on the probe → throws (real failure surfaces)", async () => {
  await assert.rejects(
    mergeSpecPr(
      "tg8dsb",
      "/repo",
      ops({
        openPrCount: async () => {
          throw Object.assign(new Error("spawn gh ENOENT"), {
            stderr: "gh: command not found",
          });
        },
      }),
    ),
    /gh pr list spec\/SP-tg8dsb failed: gh: command not found/,
  );
});

test("the ahead-count probe failing → throws (never mis-classified as no-pr)", async () => {
  await assert.rejects(
    mergeSpecPr(
      "tg8dsb",
      "/repo",
      ops({
        openPrCount: async () => 0,
        unmergedCommits: async () => {
          throw Object.assign(new Error("rev-list failed"), {
            stderr: "fatal: bad revision",
          });
        },
      }),
    ),
    /git rev-list spec\/SP-tg8dsb failed: fatal: bad revision/,
  );
});

test("a PR exists but the merge is rejected → throws, not swallowed", async () => {
  await assert.rejects(
    mergeSpecPr(
      "tg8dsb",
      "/repo",
      ops({
        openPrCount: async () => 1,
        merge: async () => {
          throw Object.assign(new Error("merge failed"), {
            stderr: "Pull request is not mergeable",
          });
        },
      }),
    ),
    /gh pr merge spec\/SP-tg8dsb failed: Pull request is not mergeable/,
  );
});
