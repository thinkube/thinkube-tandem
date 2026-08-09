// WHY (INVARIANT): a cut written before docsWaiver existed — no such field
// at all — must always load and behave exactly like a cut recorded today
// with no waiver. The optional field must never force a shape change on
// old records, now or after future edits to the schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appendRecord, loadFolded } from "../out/core/records.js";
import { emptySpace } from "../out/core/schema.js";

test("a cut with no docsWaiver loads identically to a cut authored without the field", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac2-"));
  const legacyCut = { id: "cut-1", changeIds: [] };
  const space = { ...emptySpace(), cuts: [legacyCut] };
  appendRecord(dir, { at: "2026-08-06T10:00:00Z", author: "user", kind: "snapshot", space, cut: [] });

  const folded = loadFolded(dir, dir, "user", () => "2026-08-06T10:00:01Z");
  const loaded = folded.space.cuts.find((c) => c.id === "cut-1");
  assert.ok(loaded, "the cut is still there");
  assert.equal(loaded.docsWaiver, undefined, "no waiver field appears where none was written");
  assert.deepEqual(loaded, legacyCut, "identical in shape to a cut recorded with no waiver at all");
});
