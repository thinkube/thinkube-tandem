// INVARIANT — the two behaviours the digest cache exists to guarantee, in
// one place: a dirty tree makes the cache stale (never served), and a
// repository state where nothing moved makes the cache reused (never
// re-read). src/derive/pipeline.test.ts must pin both directly on the
// public pipeline interface; this probe pins the same two behaviours as an
// independent, black-box check that survives regardless of how that unit
// test is written.
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

function initRepo(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
}

test("stale on a dirty tree: an uncommitted edit is never served the pre-edit digest", async () => {
  const repoRoot = initRepo("tandem-ac6a-");
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac6a-store-"));
  const store = makeDigestStore(storeDir);
  const readings = ["LAYOUT: clean", "LAYOUT: dirty"];
  let i = 0;
  const round = async () => readings[i++];

  const clean = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  fs.writeFileSync(path.join(repoRoot, "a.txt"), "one\nchanged\n");
  const dirty = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);

  assert.equal(clean, "LAYOUT: clean");
  assert.equal(dirty, "LAYOUT: dirty", "the dirty tree gets its own fresh digest, not the clean one");
  assert.equal(i, 2, "both derivations actually read — the cache correctly went stale");
});

test("reused when nothing moved: repeated derivations at an unchanged state read once", async () => {
  const repoRoot = initRepo("tandem-ac6b-");
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac6b-store-"));
  const store = makeDigestStore(storeDir);
  let reads = 0;
  const round = async () => {
    reads++;
    return "LAYOUT: unchanged state";
  };

  const first = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  const second = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  const third = await ensureRepoDigest({ model: "opus", repoRoot }, store, round);

  assert.equal(reads, 1, "nothing moved between derivations — the repository is read exactly once");
  assert.equal(first, "LAYOUT: unchanged state");
  assert.equal(second, first);
  assert.equal(third, first);
});
