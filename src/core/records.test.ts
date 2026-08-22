/**
 * foldSpaces must never drop a field it does not recognize by name: a
 * pending documentation exemption is pre-signature working state with no
 * id of its own to union by, and must survive both a single-record fold
 * (load) and a multi-author fold where only one author holds it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "./records";
import type { SnapshotRecord } from "./records";

test("a space carrying a pending documentation exemption, persisted and loaded again, still carries that exemption with its reason", () => {
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
  const record: SnapshotRecord = {
    at: "2026-08-18T10:00:00Z",
    author: "alice",
    kind: "snapshot",
    space: space as never,
    cut: [],
  };
  const folded = foldSpaces([record]);
  assert.ok(
    folded.pendingDocsExemption,
    "the folded space must still carry the pending documentation exemption",
  );
  assert.equal(folded.pendingDocsExemption!.reason, reason);
});

test("folding two authors' snapshots keeps a pending documentation exemption carried by only one of them", () => {
  const reason = "no user-facing surface — nothing to document";
  const withExemption: SnapshotRecord = {
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
    } as never,
    cut: [],
  };
  const withoutExemption: SnapshotRecord = {
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
    } as never,
    cut: [],
  };
  const folded = foldSpaces([withExemption, withoutExemption]);
  assert.ok(
    folded.pendingDocsExemption,
    "the folded space must keep the pending exemption carried by one author",
  );
  assert.equal(folded.pendingDocsExemption!.reason, reason);
});
