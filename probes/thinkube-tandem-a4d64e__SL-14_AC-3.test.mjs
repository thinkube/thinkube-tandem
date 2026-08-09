// INVARIANT — two derivations run at the same head with an unchanged tree
// must read the repository ONCE and share one digest; a cache that keys
// itself wrongly (or not at all) would waste a repository reading on a
// second caller who needs nothing new.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac3-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
}

test("a second derivation at the same head with an unchanged tree reuses the first digest — no second reading", async () => {
  const repoRoot = initRepo();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac3-store-"));
  const store = makeDigestStore(storeDir);
  let reads = 0;
  const round = async () => {
    reads++;
    return "LAYOUT: one shared reading";
  };

  const first = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  const second = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);

  assert.equal(reads, 1, "the repository is read once across both derivations");
  assert.equal(first, second, "both derivations end up with the same digest text");
});

test("concurrent derivations at the same unchanged state single-flight into one reading", async () => {
  const repoRoot = initRepo();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac3b-store-"));
  const store = makeDigestStore(storeDir);
  let reads = 0;
  const round = async () => {
    reads++;
    await new Promise((r) => setTimeout(r, 20));
    return "LAYOUT: concurrent shared reading";
  };

  const [a, b, c] = await Promise.all([
    ensureRepoDigest({ model: "opus", repoRoot }, store, round),
    ensureRepoDigest({ model: "opus", repoRoot }, store, round),
    ensureRepoDigest({ model: "opus", repoRoot }, store, round),
  ]);

  assert.equal(reads, 1, "three concurrent callers that all miss the cache trigger one reading, not three");
  assert.equal(a, "LAYOUT: concurrent shared reading");
  assert.equal(b, a);
  assert.equal(c, a);
});
