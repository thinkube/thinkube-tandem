/**
 * Folding two authors' snapshots where one carries a pending exemption keeps
 * that exemption in the folded space.
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

test("folding two authors keeps the pending exemption carried by only one of them", () => {
  const reason = "no user-facing surface — nothing to document";
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-render-ac7-"));
  const aliceDir = path.join(projectDir, "alice");
  const bobDir = path.join(projectDir, "bob");
  fs.mkdirSync(aliceDir, { recursive: true });
  fs.mkdirSync(bobDir, { recursive: true });

  appendRecord(aliceDir, {
    at: "2026-08-18T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: { ...emptySpaceFields, pendingDocsExemption: { reason } } as never,
    cut: [],
  } as SnapshotRecord);
  appendRecord(bobDir, {
    at: "2026-08-18T10:05:00Z",
    author: "bob",
    kind: "snapshot",
    space: { ...emptySpaceFields } as never,
    cut: [],
  } as SnapshotRecord);

  const { space: folded } = loadFolded(projectDir, aliceDir, "alice", () => "2026-08-18T10:06:00Z");
  assert.ok(
    folded.pendingDocsExemption,
    "the folded space must keep the pending exemption carried by one author",
  );
  assert.equal(folded.pendingDocsExemption!.reason, reason);
});
