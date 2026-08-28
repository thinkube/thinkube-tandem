/**
 * One experience, whoever started the run.
 *
 * A run used to keep its situation — is it happening, who is driving,
 * what did it say — in the driving process's memory, while its content
 * went to disk. So a second surface could read what a run CONTAINED and
 * never learn whether it was HAPPENING. A run started outside the editor
 * showed there as nothing; a refusal reached the defect ledger and no
 * eye; a stop was a method call one process could not deliver to another.
 *
 * The situation is written down now, and judged the way a stale execution
 * lock is judged: by whether the process that wrote it is still alive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { requestStop, runIsLive, runSituation, stopWasRequested } from "./record";
import type { RunRecord } from "./record";

const base: RunRecord = {
  cutId: "cut-1",
  tepId: "TEP-x-1",
  at: "2026-08-28T20:00:00Z",
  units: [],
  logs: [],
  stepLogs: {},
};

test("a run whose driver is alive reads as running, to anyone", () => {
  const r: RunRecord = { ...base, state: "running", owner: { pid: 4242, at: base.at } };
  assert.equal(runIsLive(r, () => true), true);
  assert.deepEqual(runSituation(r, () => true), { running: true });
});

test("a run whose driver is gone reads as ended, and says so", () => {
  const r: RunRecord = { ...base, state: "running", owner: { pid: 4242, at: base.at } };
  assert.equal(runIsLive(r, () => false), false);
  const v = runSituation(r, () => false);
  assert.equal(v.running, false);
  assert.match(v.note ?? "", /stopped without saying how it ended/);
});

test("a refusal is readable by a surface that did not start the run", () => {
  const r: RunRecord = {
    ...base,
    state: "refused",
    note: "The build could not start: these checks are born where this repository runs no test of its own.",
    owner: { pid: 4242, at: base.at },
  };
  const v = runSituation(r, () => true);
  assert.equal(v.running, false, "a refused run is not in flight, even while its process lives");
  assert.match(v.note ?? "", /runs no test of its own/);
});

test("a withheld run carries its reason, not silence", () => {
  const r: RunRecord = { ...base, state: "withheld", note: "The delivery was withheld: the product build" };
  assert.deepEqual(runSituation(r, () => true), {
    running: false,
    note: "The delivery was withheld: the product build",
  });
});

test("a record written before runs wrote their situation is not read as running", () => {
  assert.equal(runIsLive(base, () => true), false, "no state, no claim");
  assert.deepEqual(runSituation(base, () => true), { running: false });
});

test("a run claiming to run with no owner is not believed", () => {
  const r: RunRecord = { ...base, state: "running" };
  assert.equal(runIsLive(r, () => true), false, "liveness needs somebody to ask about");
});

test("a stop asked for from outside is seen by the owner", () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  fs.mkdirSync(path.join(storeDir, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(storeDir, "runs", "cut-1.json"),
    JSON.stringify({ ...base, state: "running", owner: { pid: process.pid, at: base.at } }),
  );
  const startedAt = "2026-08-28T20:00:00Z";
  assert.equal(stopWasRequested(storeDir, "cut-1", startedAt), false);
  assert.equal(requestStop(storeDir, "cut-1", "2026-08-28T20:05:00Z"), true);
  assert.equal(stopWasRequested(storeDir, "cut-1", startedAt), true);
});

test("a stop from a previous run does not end the next one", () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  fs.mkdirSync(path.join(storeDir, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(storeDir, "runs", "cut-1.json"),
    JSON.stringify({ ...base, stopRequestedAt: "2026-08-28T20:00:00Z" }),
  );
  // The new run began after that request; it is not the one being stopped.
  assert.equal(stopWasRequested(storeDir, "cut-1", "2026-08-28T20:30:00Z"), false);
});

test("asking a run that was never recorded to stop fails honestly", () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  assert.equal(requestStop(storeDir, "cut-1", "2026-08-28T20:05:00Z"), false);
});
