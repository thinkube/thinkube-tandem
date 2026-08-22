/**
 * foldSpaces must never drop a field it does not recognize by name: a
 * pending documentation exemption is pre-signature working state with no
 * id of its own to union by, and must survive both a single-record fold
 * (load) and a multi-author fold where only one author holds it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendRecord, loadFolded } from "./records";
import type { SnapshotRecord } from "./records";

const emptySpaceFields = {
  asks: [],
  nodes: [],
  units: [],
  cuts: [],
  deliveries: [],
  questions: [],
};

test("a space carrying a pending documentation exemption, persisted and loaded again, still carries that exemption with its reason", () => {
  const reason = "internal-only change; nothing for a reader to consult";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-records-"));
  const record: SnapshotRecord = {
    at: "2026-08-18T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: {
      ...emptySpaceFields,
      pendingDocsExemption: { reason },
    } as never,
    cut: [],
  };
  appendRecord(dir, record);
  const { space: folded } = loadFolded(dir, dir, "alice", () => "2026-08-18T10:01:00Z");
  assert.ok(
    folded.pendingDocsExemption,
    "the folded space must still carry the pending documentation exemption",
  );
  assert.equal(folded.pendingDocsExemption!.reason, reason);
});

test("folding two authors' snapshots keeps a pending documentation exemption carried by only one of them", () => {
  const reason = "no user-facing surface — nothing to document";
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-records-"));
  const aliceDir = path.join(projectDir, "alice");
  const bobDir = path.join(projectDir, "bob");
  fs.mkdirSync(aliceDir, { recursive: true });
  fs.mkdirSync(bobDir, { recursive: true });

  const withExemption: SnapshotRecord = {
    at: "2026-08-18T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: {
      ...emptySpaceFields,
      pendingDocsExemption: { reason },
    } as never,
    cut: [],
  };
  const withoutExemption: SnapshotRecord = {
    at: "2026-08-18T10:05:00Z",
    author: "bob",
    kind: "snapshot",
    space: { ...emptySpaceFields } as never,
    cut: [],
  };
  appendRecord(aliceDir, withExemption);
  appendRecord(bobDir, withoutExemption);

  const { space: folded } = loadFolded(projectDir, aliceDir, "alice", () => "2026-08-18T10:06:00Z");
  assert.ok(
    folded.pendingDocsExemption,
    "the folded space must keep the pending exemption carried by one author",
  );
  assert.equal(folded.pendingDocsExemption!.reason, reason);
});
