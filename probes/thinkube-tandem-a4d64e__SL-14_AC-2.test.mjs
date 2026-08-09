// INVARIANT — editing a tracked file without committing must make the next
// derivation establish and save a FRESH digest, never keep serving the
// digest that was read before the edit. A cache keyed on HEAD alone would
// silently hand back stale knowledge of code that has since changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { ensureRepoDigest } from "../out-test/derive/pipeline.js";
import { makeDigestStore } from "../out-test/surfaces/sessionStore.js";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac2-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
}

test("editing a tracked file (no commit) makes the next derivation read fresh, not serve the pre-edit digest", async () => {
  const repoRoot = initRepo();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac2-store-"));
  const store = makeDigestStore(storeDir);
  let reads = 0;
  const round = async () => {
    reads++;
    return reads === 1 ? "LAYOUT: before the edit" : "LAYOUT: after the edit";
  };

  const first = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  assert.equal(reads, 1, "the first derivation reads the repository once");
  assert.equal(first, "LAYOUT: before the edit");

  // Edit a tracked file without committing — HEAD is unchanged.
  fs.writeFileSync(path.join(repoRoot, "a.txt"), "one\nedited\n");

  const second = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  assert.equal(reads, 2, "the dirty tree forces a fresh reading rather than reusing the cached one");
  assert.equal(second, "LAYOUT: after the edit", "the fresh digest is what is served after the edit");
  assert.notEqual(second, first, "the pre-edit digest is not what the post-edit caller receives");
});
