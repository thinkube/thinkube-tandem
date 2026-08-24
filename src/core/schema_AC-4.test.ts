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

test("a second write for the same TEP leaves the second run's id and moment, not the first's", async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-record-"));
  const tep = "TEP-record-2";
  const firstRun = { runId: "TEP-record-2@first", producedAt: "2026-08-24T09:00:00.000Z" };
  const secondRun = { runId: "TEP-record-2@second", producedAt: "2026-08-24T14:45:00.000Z" };
  const common = {
    tep,
    branch: `tandem/${tep}`,
    baseSha: "deadbeef",
    proofs: [],
    undelivered: [],
    verifs: [],
    acResults: [],
  };

  await writeDeliveryRecord(store, { ...common, ...firstRun } as never);
  await writeDeliveryRecord(store, { ...common, ...secondRun } as never);

  // The record is the machine face of the LATEST run for this TEP. A re-run
  // that left the first run's identity behind would make the file name a
  // run that did not produce what it holds.
  const raw = JSON.parse(
    fs.readFileSync(path.join(store, "deliveries", `${tep}.json`), "utf8"),
  ) as { runId?: string; producedAt?: string };

  assert.equal(raw.runId, secondRun.runId, "the file carries the second run's id");
  assert.equal(raw.producedAt, secondRun.producedAt, "and the second run's moment");
  assert.notEqual(raw.runId, firstRun.runId, "the first run's id was not left behind");
  assert.notEqual(raw.producedAt, firstRun.producedAt, "nor the first run's moment");
});
