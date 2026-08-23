/**
 * isDocPath calls a repo-relative path under docs/ documentation, and calls
 * a source file such as src/gates/sign.ts not documentation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocPath } from "./docs";

test("isDocPath calls a repo-relative path under docs/ documentation, and src/gates/sign.ts not", () => {
  assert.equal(isDocPath("docs/modules/ROOT/pages/gates.adoc"), true);
  assert.equal(isDocPath("docs/TERMINOLOGY.md"), true);
  assert.equal(isDocPath("src/gates/sign.ts"), false);
});
