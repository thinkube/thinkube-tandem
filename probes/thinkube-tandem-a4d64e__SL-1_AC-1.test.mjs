// INVARIANT — isDocPath must always classify a repo-relative docs/ path as
// documentation and a non-docs path (e.g. the sign gate's own source) as not
// documentation. Every later docs-gate decision (signing, the run gate, the
// render) depends on this one rule staying true, so it stands forever.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isDocPath } from "../out-test/core/docs.js";

test("isDocPath calls a repo-relative docs/ path documentation", () => {
  assert.equal(isDocPath("docs/guide.md"), true);
  assert.equal(isDocPath("docs/modules/ROOT/pages/gates.adoc"), true);
});

test("isDocPath calls src/gates/sign.ts not documentation", () => {
  assert.equal(isDocPath("src/gates/sign.ts"), false);
});
