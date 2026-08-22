// WHY (TRANSITION): the fold used to copy Space field by field, so any new
// pre-signature field silently vanished when two authors' records were
// folded. This proves the fold now carries a pending documentation
// exemption through — a persisted-then-reloaded space still holds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "../out-test/core/records.js";

test("a space carrying a pending documentation exemption survives being folded from its own persisted record", () => {
  const reason = "internal-only change; nothing for a reader to consult";
  const space = {
    asks: [],
    nodes: [],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
    pendingDocsExemption: { reason },
  };
  const record = {
    at: "2026-08-18T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space,
    cut: [],
  };
  const folded = foldSpaces([record]);
  assert.ok(
    folded.pendingDocsExemption,
    "the folded space must still carry the pending documentation exemption",
  );
  assert.equal(folded.pendingDocsExemption.reason, reason);
});
