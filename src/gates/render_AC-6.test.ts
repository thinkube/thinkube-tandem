/**
 * A space carrying a pending documentation exemption, persisted and loaded
 * again, still carries that exemption with its reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendRecord, loadFolded } from "../core/records";
import type { SnapshotRecord } from "../core/records";

const emptySpaceFields = {
  asks: [],
  nodes: [],
  units: [],
  cuts: [],
  deliveries: [],
  questions: [],
};

test("a persisted pending documentation exemption survives being loaded again, with its reason", () => {
  const reason = "internal-only change; nothing for a reader to consult";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-render-ac6-"));
  const record: SnapshotRecord = {
    at: "2026-08-18T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: { ...emptySpaceFields, pendingDocsExemption: { reason } } as never,
    cut: [],
  };
  appendRecord(dir, record);

  const { space: folded } = loadFolded(dir, dir, "alice", () => "2026-08-18T10:01:00Z");
  assert.ok(
    folded.pendingDocsExemption,
    "the loaded space must still carry the pending documentation exemption",
  );
  assert.equal(folded.pendingDocsExemption!.reason, reason);
});
