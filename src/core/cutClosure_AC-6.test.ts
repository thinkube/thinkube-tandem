/**
 * TRANSITION — isDocumentationPath must widen to call a markdown document
 * at the repository root documentation, not only a path under a docs
 * directory: before this, a docs-directory-only rule would refuse the very
 * cut that creates ENGINE-WIRING.md at the root, because the gate this
 * work adds would see no documentation touchpoint in it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocumentationPath } from "./cutClosure";

test("isDocumentationPath answers true for a markdown document at the repository root", () => {
  assert.equal(isDocumentationPath("ENGINE-WIRING.md"), true);
  assert.equal(isDocumentationPath("ENGINE-CHANGE.md"), true);
});

test("isDocumentationPath answers false for a source path at the repository root", () => {
  assert.equal(isDocumentationPath("index.ts"), false);
  assert.equal(isDocumentationPath("extension.ts"), false);
});
