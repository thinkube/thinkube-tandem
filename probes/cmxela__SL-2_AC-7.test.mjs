// WHY (TRANSITION): the multi-author fold used to copy Space field by
// field, dropping any field it did not know about the moment two authors'
// records were folded. This proves a pending documentation exemption held
// by one author's snapshot survives folding against a second author's
// snapshot that carries none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "../out-test/core/records.js";

test("folding two authors' snapshots keeps a pending documentation exemption carried by only one of them", () => {
  const reason = "no user-facing surface — nothing to document";
  const withExemption = {
    at: "2026-08-18T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: {
      asks: [],
      nodes: [],
      units: [],
      cuts: [],
      deliveries: [],
      questions: [],
      pendingDocsExemption: { reason },
    },
    cut: [],
  };
  const withoutExemption = {
    at: "2026-08-18T10:05:00Z",
    author: "bob",
    kind: "snapshot",
    space: {
      asks: [],
      nodes: [],
      units: [],
      cuts: [],
      deliveries: [],
      questions: [],
    },
    cut: [],
  };
  const folded = foldSpaces([withExemption, withoutExemption]);
  assert.ok(
    folded.pendingDocsExemption,
    "the folded space must keep the pending exemption carried by one author",
  );
  assert.equal(folded.pendingDocsExemption.reason, reason);
});
