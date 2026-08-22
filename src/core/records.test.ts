/**
 * The append-only store carries every pre-signature field of a space
 * through a persist-and-reload and through a multi-author fold, the same
 * way every other field survives — a pending documentation exemption is no
 * exception.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { emptySpace } from "./schema";
import { appendRecord, foldSpaces, loadFolded } from "./records";

test("a space carrying a pending documentation exemption, persisted and loaded again, still carries it with its reason", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-records-"));
  const reason = "internal-only change, nothing to document for users";
  const space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a tiny internal helper", at: "t" }],
    pendingDocException: { reason },
  };
  appendRecord(dir, {
    at: "2026-08-20T10:00:00Z",
    author: "t",
    kind: "snapshot",
    space,
    cut: [],
  });
  const folded = loadFolded(dir, dir, "t", () => "2026-08-20T10:00:01Z");
  assert.ok(folded.space.pendingDocException, "the loaded space still carries a pending exemption");
  assert.equal(
    folded.space.pendingDocException!.reason,
    reason,
    "the loaded pending exemption carries the exact recorded reason",
  );
});

test("folding two authors' snapshots where one carries a pending exemption keeps that exemption in the folded space", () => {
  const reason = "internal-only change, nothing to document for users";
  const a = {
    at: "2026-08-20T10:00:00Z",
    author: "alice",
    kind: "snapshot" as const,
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
    kind: "snapshot" as const,
    space: {
      ...emptySpace(),
      asks: [{ id: "ask-2", text: "add another helper", at: "t" }],
    },
    cut: [],
  };
  const folded = foldSpaces([a, b]);
  assert.ok(folded.pendingDocException, "the folded space carries the pending exemption from one author");
  assert.equal(
    folded.pendingDocException!.reason,
    reason,
    "the folded pending exemption carries the exact reason recorded by its author",
  );
});
