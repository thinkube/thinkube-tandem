import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeSpecPr, specBranch, PrOps } from "./specMerge";

/** A PrOps with safe defaults (no open PR, no-op merge), overridable per test. */
function ops(over: Partial<PrOps> = {}): PrOps {
  return {
    openPrCount: async () => 0,
    merge: async () => "",
    ...over,
  };
}

test("specBranch formats the one-branch-per-Spec name", () => {
  assert.equal(specBranch("tg8dsb"), "spec/SP-tg8dsb");
});

test("no open PR → merged:false reason no-pr, and merge is never attempted", async () => {
  let mergeCalled = false;
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({
      openPrCount: async () => 0,
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
  assert.equal(mergeCalled, false);
});

test("an open PR → merges and returns merged:true with the gh output", async () => {
  const res = await mergeSpecPr(
    "tg8dsb",
    "/repo",
    ops({ openPrCount: async () => 1, merge: async () => "Merged PR #7" }),
  );
  assert.deepEqual(res, {
    branch: "spec/SP-tg8dsb",
    merged: true,
    output: "Merged PR #7",
  });
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
