/**
 * Unit tests for the pure id helpers (TEP-0009). No vscode, no fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTepId, mintEpochId } from "./ids";

test("parseTepId accepts both legacy sequential and base36-epoch forms", () => {
  assert.equal(parseTepId("TEP-0009"), "0009"); // legacy sequential
  assert.equal(parseTepId("TEP-tg7y99"), "tg7y99"); // base36-epoch
  assert.equal(parseTepId("  TEP-0010  "), "0010"); // trimmed
  // Not a TEP handle → undefined (no false positives).
  assert.equal(parseTepId("SP-3"), undefined);
  assert.equal(parseTepId("TEP-"), undefined);
  assert.equal(parseTepId("tep-1"), undefined); // case-sensitive prefix
});

test("mintEpochId is base36, zero-padded to ≥6, and monotonic", () => {
  // A fixed instant → floor(ms/1000) in base36, padded.
  const at = 1_700_000_000_000; // ms
  const first = mintEpochId(at, 0);
  assert.equal(first.epoch, Math.floor(at / 1000));
  assert.equal(first.id, first.epoch.toString(36).padStart(6, "0"));
  assert.ok(first.id.length >= 6);

  // Same second as the guard → bumped by one, never reused.
  const same = mintEpochId(at, first.epoch);
  assert.equal(same.epoch, first.epoch + 1);
  assert.notEqual(same.id, first.id);

  // An earlier clock reading still advances past the guard (monotonic).
  const earlier = mintEpochId(at - 5000, same.epoch);
  assert.equal(earlier.epoch, same.epoch + 1);
});
