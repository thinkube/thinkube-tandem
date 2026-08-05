/**
 * provisionDetect — the no-declaration DEFAULT for worktree setup
 * (2026-07-11): tracked manifests → lockfile-pinned install steps. The
 * motivating case: thinkube-control declares no recipe, so fresh worktrees
 * had no frontend/node_modules and a signed `tsc` probe exited 127 forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { detectProvisionSteps } from "./provisionDetect";

const listed =
  (files: string[]) =>
  async (): Promise<string[]> =>
    files;

test("frontend package-lock.json detects npm ci in frontend/ (the thinkube-control case)", async () => {
  const steps = await detectProvisionSteps(
    "/repo",
    listed([
      "backend/app/main.py",
      "backend/requirements.txt",
      "frontend/package.json",
      "frontend/package-lock.json",
      "templates/service-configmap.yaml.j2",
    ]),
  );
  // requirements.txt is NOT a lockfile — no guessed pip install (the first
  // live run failed exactly there: pip with no reachable index, for a gate
  // that never needed the venv). Only the pinned npm ci is detected.
  assert.deepEqual(steps, [{ dir: "frontend", command: "npm ci" }]);
});

test("requirements.txt alone detects nothing — not a lockfile, declare a recipe", async () => {
  assert.deepEqual(
    await detectProvisionSteps("/repo", listed(["backend/requirements.txt"])),
    [],
  );
});

test("root + nested manifests: root first, one step per directory", async () => {
  const steps = await detectProvisionSteps(
    "/repo",
    listed([
      "package-lock.json",
      "package.json",
      "services/api/go.sum",
      "tools/Cargo.lock",
      "tools/Cargo.toml",
    ]),
  );
  assert.deepEqual(steps, [
    { dir: "", command: "npm ci" },
    { dir: "tools", command: "cargo fetch" },
    { dir: "services/api", command: "go mod download" },
  ]);
});

test("no lockfile → no guess (a bare package.json detects nothing)", async () => {
  const steps = await detectProvisionSteps(
    "/repo",
    listed(["package.json", "src/index.ts"]),
  );
  assert.deepEqual(steps, []);
});

test("a pure-docs repo detects nothing (genuine no-op)", async () => {
  assert.deepEqual(
    await detectProvisionSteps("/repo", listed(["README.md", "docs/x.adoc"])),
    [],
  );
});

test("first matching ecosystem wins per directory (npm beats a stray yarn.lock)", async () => {
  const steps = await detectProvisionSteps(
    "/repo",
    listed(["package-lock.json", "yarn.lock"]),
  );
  assert.deepEqual(steps, [{ dir: "", command: "npm ci" }]);
});

// ── provisionWorktree: detected steps skip missing toolchains ───────────────
// (2026-07-11 second live failure: a Go component built only in the cluster
// hard-blocked worktree creation on a host with no `go`.)
import { provisionWorktree } from "./worktreeProvision";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

function gitRepoWith(files: Record<string, string>): string {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "tk-prov-skip-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  for (const [rel, content] of Object.entries(files)) {
    fsSync.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fsSync.writeFileSync(path.join(dir, rel), content);
  }
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
  return dir;
}

test("a detected step with no installed toolchain is SKIPPED; present ones still run", async () => {
  const repo = gitRepoWith({
    "proxy/go.sum": "x",
    "frontend/package-lock.json": "{}",
  });
  const calls: string[] = [];
  const exec = async (run: string) => {
    calls.push(run);
    if (run.startsWith("command -v"))
      return { code: run.includes(" go") ? 127 : 0, output: "" };
    return { code: 0, output: "" };
  };
  const r = await provisionWorktree(repo, repo, { exec });
  assert.equal(r.ran, true);
  assert.equal(r.code, 0);
  assert.match(r.command!, /npm ci \(in frontend\/\)/);
  assert.match(r.command!, /skipped: go mod download \(in proxy\/\) — `go` not installed/);
  assert.ok(!calls.includes("go mod download"), "the go step must never execute");
});

test("a detected step whose PRESENT toolchain fails still fails hard", async () => {
  const repo = gitRepoWith({ "frontend/package-lock.json": "{}" });
  const exec = async (run: string) =>
    run.startsWith("command -v")
      ? { code: 0, output: "" }
      : { code: 1, output: "npm ERR! network" };
  const r = await provisionWorktree(repo, repo, { exec });
  assert.equal(r.ran, true);
  assert.equal(r.code, 1);
  assert.match(r.command!, /npm ci/);
});
