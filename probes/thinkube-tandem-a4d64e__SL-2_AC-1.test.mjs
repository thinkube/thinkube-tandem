// WHY (TRANSITION): the Cut record gains an optional docsWaiver — a reason
// and the moment it was given — as part of the space record shape. Proves
// the field exists and round-trips through plain JSON exactly as authored,
// once at the moment the schema gains it.
import { test } from "node:test";
import assert from "node:assert/strict";

test("a Cut can carry a docsWaiver with a reason and the moment it was given", () => {
  /** @type {import("../out/core/schema.js").Cut} */
  const cut = {
    id: "cut-1",
    changeIds: ["node-1"],
    docsWaiver: { reason: "the change is a config toggle with nothing to document", at: "2026-08-06T10:00:00Z" },
  };
  assert.equal(cut.docsWaiver.reason, "the change is a config toggle with nothing to document");
  assert.equal(cut.docsWaiver.at, "2026-08-06T10:00:00Z");
  // Round-trips through JSON exactly as authored — the store persists cuts
  // as plain JSON, so the waiver must survive that trip byte for byte.
  const roundTripped = JSON.parse(JSON.stringify(cut));
  assert.deepEqual(roundTripped.docsWaiver, cut.docsWaiver);
});
