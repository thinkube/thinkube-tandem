// WHY (INVARIANT): isDocPath is the one rule that says what counts as
// documentation — a repo-relative path under docs/ is documentation, and a
// source file such as src/gates/sign.ts is not. Every gate that needs to
// know "is this a doc page" must be able to ask this function and get the
// same answer forever, so this must hold for as long as the rule exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocPath } from "../out-test/core/docs.js";

test("isDocPath calls a repo-relative path under docs/ documentation", () => {
  assert.equal(isDocPath("docs/modules/ROOT/pages/gates.adoc"), true);
  assert.equal(isDocPath("docs/TERMINOLOGY.md"), true);
});

test("isDocPath calls src/gates/sign.ts not documentation", () => {
  assert.equal(isDocPath("src/gates/sign.ts"), false);
});
