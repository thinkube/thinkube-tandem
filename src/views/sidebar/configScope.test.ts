/**
 * Unit tests for the Configuration view's selection-scope decision
 * (SP-tgvhfk_SL-1). fs via a tmp dir; no vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveSelectedScope } from "./configScope";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-cfgscope-"));
}

test("no selection → none (no hardcoded workspace roots)", () => {
  const scope = resolveSelectedScope(undefined);
  assert.equal(scope.kind, "none");
});

test("selected repo with .claude/ → project, hasConfig true, path+name carried", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".claude"));
  const scope = resolveSelectedScope({ path: dir, name: "thinkube" });
  assert.equal(scope.kind, "project");
  if (scope.kind !== "project") return;
  assert.equal(scope.path, dir);
  assert.equal(scope.name, "thinkube");
  assert.equal(scope.hasConfig, true);
});

test("selected repo with only CLAUDE.md → hasConfig true", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# hi");
  const scope = resolveSelectedScope({ path: dir, name: "x" });
  assert.equal(scope.kind, "project");
  if (scope.kind !== "project") return;
  assert.equal(scope.hasConfig, true);
});

test("selected repo with neither → project, hasConfig false", () => {
  const dir = tmp();
  const scope = resolveSelectedScope({ path: dir, name: "x" });
  assert.equal(scope.kind, "project");
  if (scope.kind !== "project") return;
  assert.equal(scope.hasConfig, false);
});

test("exists is injectable (no disk touch)", () => {
  const scope = resolveSelectedScope(
    { path: "/repo", name: "r" },
    (p) => p === path.join("/repo", ".claude"),
  );
  assert.equal(scope.kind, "project");
  if (scope.kind !== "project") return;
  assert.equal(scope.hasConfig, true);
});
