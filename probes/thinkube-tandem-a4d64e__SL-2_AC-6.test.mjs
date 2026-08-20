// WHY (TRANSITION): the fold copies Space field by field, so a new
// pre-signature field is silently dropped unless the fold is taught about
// it — this proves a pending documentation exemption survives a persist and
// a reload through the real append-only store.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { emptySpace } from "../out-test/core/schema.js";
import { appendRecord, loadFolded } from "../out-test/core/records.js";

test("a space carrying a pending documentation exemption, persisted and loaded again, still carries it with its reason", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-ac6-"));
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
  assert.ok(folded.space.pendingDocException, "the loaded space must still carry a pending exemption");
  assert.equal(
    folded.space.pendingDocException.reason,
    reason,
    "the loaded pending exemption must carry the exact recorded reason",
  );
});
