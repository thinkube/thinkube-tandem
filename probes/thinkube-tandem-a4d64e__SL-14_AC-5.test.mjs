// INVARIANT — one exported accessor returns the current shared digest for a
// repository. On a cache miss it establishes the digest itself (a single
// in-flight reading, even under concurrent callers) and hands the caller
// the text directly — no separate lookup step is needed to get the value.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac5-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
}

test("ensureRepoDigest returns the digest text directly on a cache miss", async () => {
  const repoRoot = initRepo();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac5-store-"));
  const store = makeDigestStore(storeDir);
  const round = async () => "LAYOUT: established on miss";

  const digest = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);

  assert.equal(
    digest,
    "LAYOUT: established on miss",
    "the accessor itself hands back the current digest text, not just a side effect on the store",
  );
});

test("ensureRepoDigest returns the digest directly on a cache hit too, without re-reading", async () => {
  const repoRoot = initRepo();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac5b-store-"));
  const store = makeDigestStore(storeDir);
  let reads = 0;
  const round = async () => {
    reads++;
    return "LAYOUT: only established once";
  };

  await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  const digest = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);

  assert.equal(reads, 1, "the second call is a cache hit — no second reading");
  assert.equal(digest, "LAYOUT: only established once", "the accessor still returns the current digest on a hit");
});

test("concurrent misses establish the digest via a single in-flight reading and every caller gets it", async () => {
  const repoRoot = initRepo();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac5c-store-"));
  const store = makeDigestStore(storeDir);
  let reads = 0;
  const round = async () => {
    reads++;
    await new Promise((r) => setTimeout(r, 20));
    return "LAYOUT: single in-flight reading";
  };

  const [a, b] = await Promise.all([
    ensureRepoDigest({ model: "opus", repoRoot }, store, round),
    ensureRepoDigest({ model: "opus", repoRoot }, store, round),
  ]);

  assert.equal(reads, 1, "two concurrent misses share one in-flight reading");
  assert.equal(a, "LAYOUT: single in-flight reading");
  assert.equal(b, a, "both concurrent callers receive the same established digest");
});
