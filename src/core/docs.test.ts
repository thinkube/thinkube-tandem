/**
 * The one rule for what counts as documentation, proved directly: a
 * repo-relative path under `docs/` is documentation, everything else
 * — including the gate that reads this rule — is not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isDocPath } from "./docs";

test("isDocPath calls a repo-relative docs/ path documentation, and the sign gate's own source not documentation", () => {
  assert.equal(isDocPath("docs/guide.md"), true);
  assert.equal(isDocPath("docs/modules/ROOT/pages/gates.adoc"), true);
  assert.equal(isDocPath("src/gates/sign.ts"), false);
});
