/**
 * INVARIANT — isDocumentationPath must answer true for a path under a docs
 * directory and false for a source path, because the sign gate's documents-
 * something check is exactly this one predicate: get it wrong here and the
 * gate refuses documentation it should accept, or accepts source it should
 * refuse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocumentationPath } from "./cutClosure";

test("isDocumentationPath answers true for a path under a docs directory", () => {
  assert.equal(isDocumentationPath("docs/modules/ROOT/pages/gates.adoc"), true);
  assert.equal(isDocumentationPath("docs/RULES.md"), true);
});

test("isDocumentationPath answers false for a source path", () => {
  assert.equal(isDocumentationPath("src/core/cutClosure.ts"), false);
  assert.equal(isDocumentationPath("src/gates/sign.ts"), false);
});
