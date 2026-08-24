/**
 * INVARIANT — two runs of the same TEP against the same store leave a
 * record naming the SECOND run, not the first: a later run must never be
 * silently indistinguishable from an earlier one it overwrote.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeDeliveryRecord } from "../run/plan";
import { runStamp } from "../run/dispatch";

test("a second run of the same TEP against the same store leaves a record naming the second run", async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-store-"));
  const tep = "TEP-record-2";
  const first = runStamp(tep, Date.parse("2026-08-24T10:00:00.000Z"));
  const second = runStamp(tep, Date.parse("2026-08-24T11:00:00.000Z"));
  assert.notEqual(first.id, second.id, "two runs at different moments must mint different ids");

  await writeDeliveryRecord(store, {
    tep,
    branch: "tandem/TEP-record-2",
    baseSha: "aaa",
    proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
    undelivered: [],
    verifs: [],
    acResults: [],
    runId: first.id,
    producedAt: first.at,
  } as never);

  await writeDeliveryRecord(store, {
    tep,
    branch: "tandem/TEP-record-2",
    baseSha: "bbb",
    proofs: [{ kind: "probe", label: "it works", verdict: "green" }],
    undelivered: [],
    verifs: [],
    acResults: [],
    runId: second.id,
    producedAt: second.at,
  } as never);

  const written = JSON.parse(
    fs.readFileSync(path.join(store, "deliveries", `${tep}.json`), "utf8"),
  ) as { runId?: string; producedAt?: string };

  assert.equal(written.runId, second.id, "the record must name the second run after its write");
  assert.notEqual(written.runId, first.id, "the first run's id must not survive the second run's write");
  assert.equal(written.producedAt, second.at);
});
