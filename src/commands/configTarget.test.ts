/**
 * Unit tests for config CRUD scope resolution (SP-tgvhfk_SL-2). No vscode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveConfigTarget } from "./configTarget";
import { createDefaultConfig } from "../models/ClaudeConfig";

test("explicit tree-item path wins over everything", () => {
  assert.equal(
    resolveConfigTarget("/repo/item", "/repo/selected", "/repo/active"),
    "/repo/item",
  );
});

test("no item → the navigator-selected repo (not the active context)", () => {
  assert.equal(
    resolveConfigTarget(undefined, "/repo/selected", "/repo/active"),
    "/repo/selected",
  );
});

test("no item, no selection → falls back to the active context", () => {
  assert.equal(
    resolveConfigTarget(undefined, undefined, "/repo/active"),
    "/repo/active",
  );
});

test("nothing resolvable → undefined", () => {
  assert.equal(resolveConfigTarget(undefined, undefined, undefined), undefined);
});

test("resolved target maps writes under <selected-repo>/.claude/ and re-lists (round-trip)", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tk-cfgtarget-"));
  // No explicit item, no active context → the selected repo is the target.
  const target = resolveConfigTarget(undefined, repo, undefined);
  assert.equal(target, repo);

  // The write primitives resolve their dirs from this target via the shared
  // createDefaultConfig — so a created skill lands under <repo>/.claude/skills.
  const cfg = createDefaultConfig(target!);
  assert.equal(cfg.skillsDir, `${repo}/.claude/skills`);

  // Create→read round-trip at the resolved dir.
  fs.mkdirSync(path.join(cfg.skillsDir, "demo"), { recursive: true });
  fs.writeFileSync(path.join(cfg.skillsDir, "demo", "SKILL.md"), "# demo");
  assert.ok(fs.readdirSync(cfg.skillsDir).includes("demo"));
});
