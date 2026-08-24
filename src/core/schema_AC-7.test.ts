/**
 * INVARIANT — the delivery record file a run writes into a temporary store
 * names that run's id and the time it was produced, so the file on disk is
 * never a nameless snapshot nothing distinguishes from any other run's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeDeliveryRecord } from "../run/plan";
import { runStamp } from "../run/dispatch";

test("the delivery record file names the run's id and its produced-at time", async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const tep = "TEP-record-1";
  const stamp = runStamp(tep, Date.parse("2026-08-24T10:00:00.000Z"));

  await writeDeliveryRecord(store, {
    tep,
    branch: "tandem/TEP-record-1",
    baseSha: "abc123",
    proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
    undelivered: [],
    verifs: [],
    acResults: [],
    runId: stamp.id,
    producedAt: stamp.at,
  } as never);

  const written = JSON.parse(
    fs.readFileSync(path.join(store, "deliveries", `${tep}.json`), "utf8"),
  ) as { runId?: string; producedAt?: string };

  assert.equal(written.runId, stamp.id, "the record file does not name the run that wrote it");
  assert.equal(written.producedAt, stamp.at, "the record file does not name when it was produced");
});
