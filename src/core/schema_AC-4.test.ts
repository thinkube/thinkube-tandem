/**
 * TRANSITION — writeDeliveryRecord does not yet persist a run's identity or
 * its moment. This proves that once it does, the on-disk record at
 * deliveries/<tep>.json carries runId and producedAt exactly as given —
 * the machine-face record must name the run that produced it, same as the
 * delivery object does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeDeliveryRecord } from "../run/plan";

test("writeDeliveryRecord writes runId and producedAt into deliveries/<tep>.json", async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-record-"));
  const runId = "TEP-record-1@abc123";
  const producedAt = "2026-08-24T10:00:00.000Z";
  await writeDeliveryRecord(store, {
    tep: "TEP-record-1",
    branch: "tandem/TEP-record-1",
    baseSha: "deadbeef",
    runId,
    producedAt,
    proofs: [],
    undelivered: [],
    verifs: [],
    acResults: [],
  } as never);

  const raw = JSON.parse(
    fs.readFileSync(path.join(store, "deliveries", "TEP-record-1.json"), "utf8"),
  ) as { runId?: string; producedAt?: string };
  assert.equal(raw.runId, runId, "the record names the run that produced it");
  assert.equal(raw.producedAt, producedAt, "and the moment it was produced");
});
