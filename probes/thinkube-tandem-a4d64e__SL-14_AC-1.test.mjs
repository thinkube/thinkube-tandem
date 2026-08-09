// INVARIANT — the digest cache key must be derived from the whole repository
// stamp (committed HEAD *and* the uncommitted-changes digest), never from
// HEAD alone, so a dirty tree is never mistaken for the commit it sits on.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { digestKeyFor } from "../out-test/derive/pipeline.js";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac1-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
}

test("digestKeyFor differs between a clean tree and a dirty tree at the SAME head", async () => {
  const root = initRepo();

  const cleanKey = await digestKeyFor(root);

  fs.writeFileSync(path.join(root, "a.txt"), "one\nedited\n");
  const dirtyKey = await digestKeyFor(root);

  const headAfter = git(root, ["rev-parse", "HEAD"]);
  const headBefore = git(root, ["rev-parse", "HEAD"]);
  assert.equal(headAfter, headBefore, "editing without committing does not move HEAD");

  assert.notEqual(
    cleanKey,
    dirtyKey,
    "the key must change when the tree goes dirty even though HEAD is unchanged — a head-only key would keep them equal",
  );
});

test("digestKeyFor is stable when neither head nor the tree changed", async () => {
  const root = initRepo();
  const k1 = await digestKeyFor(root);
  const k2 = await digestKeyFor(root);
  assert.equal(k1, k2, "same head, same (clean) tree → same key");
});
