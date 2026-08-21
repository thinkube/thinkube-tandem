/**
 * `src/hostui/projectsTree.ts` extends `vscode.TreeItem` and constructs a
 * live `vscode.EventEmitter`, so it cannot be loaded under plain
 * `node:test` (no `vscode` module is resolvable outside the running
 * editor). Its source text is the one seam these checks can honestly
 * observe without starting the extension host.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const repo = path.resolve(__dirname, "..", "..");
const src = readFileSync(path.join(repo, "src", "hostui", "projectsTree.ts"), "utf8");

test("open-state marking no longer collapses to a single remembered activeSpace slug: neither the RepositoryItem nor the WorkProjectItem branch compares a space's slug to one remembered slug", () => {
  const repoBranch = src.slice(
    src.indexOf("if (el instanceof RepositoryItem)"),
    src.indexOf("if (el instanceof WorkProjectItem)"),
  );
  assert.ok(
    !/s\.slug === activeSlug/.test(repoBranch),
    "marking a space open in the RepositoryItem branch must not be a single-slug equality check — that can mark at most one space per owner",
  );

  const wpBranch = src.slice(
    src.indexOf("if (el instanceof WorkProjectItem)"),
    src.lastIndexOf("return [];"),
  );
  assert.ok(
    !/s\.slug === activeSlug/.test(wpBranch),
    "marking a space open in the WorkProjectItem branch must not be a single-slug equality check — that can mark at most one space per owner",
  );
});

test("ProjectsTreeProvider is constructed with a per-space open-state query, not only the remembered activeSpace slug — so a space whose tab was closed can stop being marked open independently of what slug is still remembered", () => {
  const ctorStart = src.indexOf("constructor(");
  assert.ok(ctorStart >= 0, "ProjectsTreeProvider must declare a constructor");
  const ctorEnd = src.indexOf(") {}", ctorStart);
  const ctorParams = src.slice(ctorStart, ctorEnd);
  assert.ok(
    /is(SpaceOpen|Open|TabOpen)\s*:/.test(ctorParams) || /is(SpaceOpen|Open|TabOpen)\s*\(/.test(ctorParams),
    "the constructor must take a per-space open-state query (e.g. isSpaceOpen/isOpen), " +
      "not only the single remembered activeSpace slug",
  );
});
