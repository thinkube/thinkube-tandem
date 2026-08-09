// INVARIANT — after a refresh, the digests directory on disk must hold
// exactly the digest for the current repository state and no superseded
// digest files, so the store never accumulates stale readings nobody will
// ever load again.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac4-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
}

function listDigestFiles(storeDir) {
  const dir = path.join(storeDir, "digests");
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

test("after a refresh, only the digest for the current repository state remains on disk", async () => {
  const repoRoot = initRepo();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac4-store-"));
  const store = makeDigestStore(storeDir);
  let reads = 0;
  const round = async () => {
    reads++;
    return `LAYOUT: reading #${reads}`;
  };

  await ensureRepoDigest({ model: "opus", repoRoot }, store, round);
  const filesAfterFirst = listDigestFiles(storeDir);
  assert.equal(filesAfterFirst.length, 1, "one digest file for the first (clean) state");

  // Move the repository to a new state without committing — forces a refresh.
  fs.writeFileSync(path.join(repoRoot, "a.txt"), "one\nedited\n");
  await ensureRepoDigest({ model: "opus", repoRoot }, store, round);

  const filesAfterRefresh = listDigestFiles(storeDir);
  assert.equal(
    filesAfterRefresh.length,
    1,
    `only the current digest should remain on disk, found: ${filesAfterRefresh.join(", ")}`,
  );
  assert.notDeepEqual(
    filesAfterRefresh,
    filesAfterFirst,
    "the surviving file names the new state, not the superseded one",
  );
});
