/**
 * AC#3 — no-leak audit via `git check-ignore`.
 *
 * `provisioningArtifactsIgnored(repoRoot, outputs)` decides "ignored" by shelling
 * **`git check-ignore`** inside a hermetic tmp git repo, so its verdict matches
 * git's real semantics for regular **files** and an on-disk **symlink**. The
 * cautionary #16 case is exact: a `node_modules/` dir pattern does **not** cover
 * a `node_modules` *symlink* (git treats it as a plain file), so a recipe whose
 * `.gitignore` "looks" right still leaks — caught here and named. Run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  provisioningArtifactsIgnored,
  describeProvisioningLeak,
} from "./provisioningLeak";

/** A hermetic git repo with the given `.gitignore` body. Returns its path. */
function initRepo(gitignore: string): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), "tk-leak-"));
  execFileSync("git", ["-C", repo, "init", "-q"], { stdio: "pipe" });
  writeFileSync(path.join(repo, ".gitignore"), gitignore);
  return repo;
}

test("all declared outputs gitignored → ignored, nothing leaked", async () => {
  const repo = initRepo("node_modules/\n.venv/\n.provisioned\n");
  await fs.mkdir(path.join(repo, "node_modules")); // a real dir → dir pattern matches
  await fs.writeFile(path.join(repo, ".provisioned"), "");

  const report = await provisioningArtifactsIgnored(repo, [
    "node_modules",
    ".provisioned",
  ]);

  assert.equal(report.ignored, true);
  assert.deepEqual(report.leaked, []);
  assert.equal(describeProvisioningLeak(report), "ignored");
});

test("the #16 trap: a `node_modules/` dir pattern does NOT cover a node_modules SYMLINK", async () => {
  // The exact gap from #16: dir-only pattern, but provisioning produced a symlink.
  const repo = initRepo("node_modules/\n");
  await fs.mkdir(path.join(repo, "real-deps"));
  await fs.symlink(
    path.join(repo, "real-deps"),
    path.join(repo, "node_modules"),
    "dir",
  );

  const report = await provisioningArtifactsIgnored(repo, ["node_modules"]);

  assert.equal(report.ignored, false);
  assert.deepEqual(report.leaked, ["node_modules"]);
  assert.equal(describeProvisioningLeak(report), "leak: node_modules");
});

test("a slash-free `node_modules` pattern DOES cover the symlink", async () => {
  const repo = initRepo("node_modules\n");
  await fs.mkdir(path.join(repo, "real-deps"));
  await fs.symlink(
    path.join(repo, "real-deps"),
    path.join(repo, "node_modules"),
    "dir",
  );

  const report = await provisioningArtifactsIgnored(repo, ["node_modules"]);

  assert.equal(report.ignored, true);
  assert.deepEqual(report.leaked, []);
});

test("mixed: names exactly the uncovered output(s)", async () => {
  const repo = initRepo("node_modules\n"); // covers node_modules, NOT .provisioned
  const report = await provisioningArtifactsIgnored(repo, [
    "node_modules",
    ".provisioned",
  ]);

  assert.equal(report.ignored, false);
  assert.deepEqual(report.leaked, [".provisioned"]);
  assert.equal(
    report.outputs.find((o) => o.path === "node_modules")?.ignored,
    true,
  );
});

test("a real git error (not a 1-vs-0 verdict) is surfaced, not swallowed", async () => {
  // /nonexistent is not a git repo → git exits 128 → must reject, not return false.
  await assert.rejects(() =>
    provisioningArtifactsIgnored("/nonexistent-tk-leak-xyz", ["node_modules"]),
  );
});
