// WHY (TRANSITION): folding two authors' snapshots must not drop a pending
// documentation exemption held by only one of them — proves foldSpaces
// carries the new pre-signature field through a multi-author fold, not just
// a single-record load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpace } from "../out-test/core/schema.js";
import { foldSpaces } from "../out-test/core/records.js";

test("folding two authors' snapshots where one carries a pending exemption keeps that exemption in the folded space", () => {
  const reason = "internal-only change, nothing to document for users";
  const a = {
    at: "2026-08-20T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: {
      ...emptySpace(),
      asks: [{ id: "ask-1", text: "add a tiny internal helper", at: "t" }],
      pendingDocException: { reason },
    },
    cut: [],
  };
  const b = {
    at: "2026-08-20T10:00:05Z",
    author: "bob",
    kind: "snapshot",
    space: {
      ...emptySpace(),
      asks: [{ id: "ask-2", text: "add another helper", at: "t" }],
    },
    cut: [],
  };
  const folded = foldSpaces([a, b]);
  assert.ok(folded.pendingDocException, "the folded space must carry the pending exemption from one author");
  assert.equal(
    folded.pendingDocException.reason,
    reason,
    "the folded pending exemption must carry the exact reason recorded by its author",
  );
});
