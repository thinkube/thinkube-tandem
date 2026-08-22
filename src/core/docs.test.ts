/**
 * The one rule for what counts as documentation: a repo-relative path
 * under `docs/` is documentation, and a source file such as
 * src/gates/sign.ts is not. Every gate that needs to know "is this a doc
 * page" must be able to ask isDocPath and get the same answer forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocPath } from "./docs";

test("isDocPath calls a repo-relative path under docs/ documentation, and a source file not", () => {
  assert.equal(isDocPath("docs/modules/ROOT/pages/gates.adoc"), true);
  assert.equal(isDocPath("docs/TERMINOLOGY.md"), true);
  assert.equal(isDocPath("src/gates/sign.ts"), false);
});
