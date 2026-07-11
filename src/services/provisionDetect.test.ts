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
      "frontend/package.json",
      "frontend/package-lock.json",
      "templates/service-configmap.yaml.j2",
    ]),
  );
  assert.deepEqual(steps, [{ dir: "frontend", command: "npm ci" }]);
});

test("root + nested manifests: root first, one step per directory", async () => {
  const steps = await detectProvisionSteps(
    "/repo",
    listed([
      "package-lock.json",
      "package.json",
      "services/api/go.mod",
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
