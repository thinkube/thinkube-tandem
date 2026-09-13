/**
 * What others write on a run's record reaches the driver and survives
 * the driver's own saves: a stop, and an answer to a parked worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { answersRequested, requestAnswer, requestStop, saveRun, stopWasRequested } from "./record";
import { RunState } from "./state";

function space(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "record-answers-"));
}

test("an answer written by a watcher is read by the driver, once, since the run began", () => {
  const dir = space();
  const state = new RunState(() => {});
  saveRun(dir, { cutId: "cut-1", at: "2026-09-13T10:00:00Z", owner: { pid: process.pid, at: "2026-09-13T10:00:00Z" }, state: "running" }, state);
  assert.equal(requestAnswer(dir, "cut-1", "SL-1#eu-0", "use the blue one", "2026-09-13T10:05:00Z"), true);
  assert.deepEqual(answersRequested(dir, "cut-1", "2026-09-13T10:00:00Z"), [
    { unit: "SL-1#eu-0", text: "use the blue one", at: "2026-09-13T10:05:00Z" },
  ]);
  assert.deepEqual(answersRequested(dir, "cut-1", "2026-09-13T10:06:00Z"), [], "an answer from before this run is not this run's");
  assert.equal(requestAnswer(dir, "cut-9", "u", "t", "now"), false, "no record, no answer");
});

test("the driver's own save keeps what others wrote on the record", () => {
  const dir = space();
  const state = new RunState(() => {});
  const head = { cutId: "cut-1", at: "2026-09-13T10:00:00Z", owner: { pid: process.pid, at: "2026-09-13T10:00:00Z" }, state: "running" as const };
  saveRun(dir, head, state);
  requestAnswer(dir, "cut-1", "u-1", "yes", "2026-09-13T10:01:00Z");
  requestStop(dir, "cut-1", "2026-09-13T10:02:00Z");
  saveRun(dir, { ...head, at: "2026-09-13T10:03:00Z" }, state);
  assert.equal(stopWasRequested(dir, "cut-1", "2026-09-13T10:00:00Z"), true, "the stop survived the save");
  assert.equal(answersRequested(dir, "cut-1", "2026-09-13T10:00:00Z").length, 1, "the answer survived the save");
});
