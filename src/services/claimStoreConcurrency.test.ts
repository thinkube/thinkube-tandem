/**
 * Regression test (orchestrator): the makespan scheduler calls the ownership arbiter's
 * acquire()/release() concurrently (up to the per-Spec cap), each triggering a persist().
 * The JournalClaimStore wrote to a single `${file}.tmp` then renamed it — so concurrent
 * persists raced: two writes to one temp file, two renames, the second hitting
 * `ENOENT … rename ownership-claims.json.tmp` because the first had already moved it.
 * persist() now serializes its writes; this fires many at once and asserts none throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { JournalClaimStore } from "./OwnershipArbiter";

test("JournalClaimStore.persist: concurrent writes don't race on the shared temp file", async () => {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "tk-claims-"));
  const file = path.join(dir, "ownership-claims.json");
  const store = new JournalClaimStore(file);

  // 20 persists fired together — without serialization this throws ENOENT on rename.
  await Promise.all(
    Array.from({ length: 20 }, () =>
      store.persist({} as Parameters<typeof store.persist>[0]),
    ),
  );

  // The journal is intact + valid JSON (no truncated/half-renamed file).
  const onDisk = JSON.parse(fsSync.readFileSync(file, "utf8"));
  assert.equal(typeof onDisk, "object");
});
