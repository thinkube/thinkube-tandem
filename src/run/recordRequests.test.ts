/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A run record is shared by the process driving the run and the processes
 * writing requests on it. Each write replaces the file whole, a stop asked
 * by another process reaches the driver and survives its next save, and a
 * record that cannot be read is said, never taken for an absent one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RunState } from "./state";
import { readRun, requestStop, runsOnFile, saveRun, stopWasRequested } from "./record";

function running(storeDir: string): RunState {
  const st = new RunState(() => {});
  st.seed("SL-1#eu-0", "SL-1", "code");
  saveRun(storeDir, { cutId: "cut-2", at: "2026-10-16T08:14:00.000Z", state: "running", owner: { pid: process.pid, at: "2026-10-16T08:14:00.000Z" } }, st);
  return st;
}

test("a stop asked by a process that does not drive the run reaches it, and the driver's next save keeps it", () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-record-stop-"));
  const st = running(storeDir);
  const live = readRun(storeDir, () => {});
  assert.equal(live?.running, true);
  assert.equal(live?.cutId, "cut-2");

  assert.equal(requestStop(storeDir, "cut-2", "2026-10-16T09:14:33.000Z"), true);
  saveRun(storeDir, { cutId: "cut-2", at: "2026-10-16T08:14:00.000Z", state: "running", owner: { pid: process.pid, at: "2026-10-16T08:14:00.000Z" } }, st);
  assert.equal(stopWasRequested(storeDir, "cut-2", "2026-10-16T08:14:00.000Z"), true);
  const left = fs.readdirSync(path.dirname(path.join(storeDir, "runs", "x"))).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(left, [], "every write replaced the record whole");
});

test("a cut with no record cannot be asked to stop, and was asked nothing", () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-record-none-"));
  assert.equal(requestStop(storeDir, "cut-9", "2026-10-16T09:00:00.000Z"), false);
  assert.equal(stopWasRequested(storeDir, "cut-9", "2026-10-16T08:00:00.000Z"), false);
  assert.deepEqual(runsOnFile(storeDir), [], "a space that ran nothing has no runs");
});

test("a record that cannot be read is said, naming the file", () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-record-bad-"));
  running(storeDir);
  const file = path.join(storeDir, "runs", "cut-2.json");
  fs.writeFileSync(file, '{"cutId": "cut-2", "units": [');
  assert.throws(() => runsOnFile(storeDir), /the run record .*cut-2\.json cannot be read/);
  assert.throws(() => stopWasRequested(storeDir, "cut-2", "2026-10-16T08:00:00.000Z"), /cannot be read/);
});
