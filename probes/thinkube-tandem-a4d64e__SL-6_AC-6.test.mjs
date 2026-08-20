// WHY (TRANSITION): the tree used to mark only the single remembered
// activeSpace(ownerKey) slug as open per owner — so a second space opened
// in its own tab showed nowhere as open. This proves the marking logic no
// longer collapses to that one-slug comparison, so two open spaces of one
// owner can both be marked. src/hostui/projectsTree.ts extends vscode.TreeItem
// and constructs a live vscode.EventEmitter, so it cannot be loaded under
// plain node:test (no vscode module is resolvable outside the running
// editor) — this reads the provider's source text, the one seam this probe
// can honestly observe without starting the extension host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/hostui/projectsTree.ts", import.meta.url), "utf8");

test("the RepositoryItem branch no longer marks 'open' by comparing a space's slug to one remembered activeSpace slug", () => {
  const repoBranch = src.slice(
    src.indexOf("if (el instanceof RepositoryItem)"),
    src.indexOf("if (el instanceof WorkProjectItem)"),
  );
  assert.ok(
    !/s\.slug === activeSlug/.test(repoBranch),
    "marking a space open must no longer be a single-slug equality check — that can mark at most one space per owner",
  );
});

test("the WorkProjectItem branch no longer marks 'open' by comparing a space's slug to one remembered activeSpace slug", () => {
  const wpBranch = src.slice(
    src.indexOf("if (el instanceof WorkProjectItem)"),
    src.lastIndexOf("return [];"),
  );
  assert.ok(
    !/s\.slug === activeSlug/.test(wpBranch),
    "marking a space open must no longer be a single-slug equality check — that can mark at most one space per owner",
  );
});
