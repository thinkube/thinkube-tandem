/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A session with a driver to start hands the run to it and follows the
 * record; one without drives the run itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { emptySpace } from "../core/schema";
import { RunState } from "../run/state";
import { saveRun } from "../run/record";

function sessionWith(runElsewhere?: (a: { fresh: boolean }) => Promise<{ ok: boolean; reason?: string }>): { s: TandemSession; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "start-run-"));
  const s = new TandemSession({
    author: "tester",
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
    ...(runElsewhere ? { runElsewhere } : {}),
  } as never);
  s.space = emptySpace();
  return { s, dir };
}

test("the run is handed to the driver, and the session shows it running once the record says so", async () => {
  const seen: { fresh: boolean }[] = [];
  const { s, dir } = sessionWith(async (a) => {
    seen.push(a);
    // What a driver does within seconds: writes its record, running, with its pid.
    setTimeout(() => {
      saveRun(dir, { cutId: "cut-1", at: new Date().toISOString(), owner: { pid: process.pid, at: new Date().toISOString() }, state: "running" }, new RunState(() => {}));
    }, 200);
    return { ok: true };
  });
  const pending = s.startRun("cut-1", true);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(s.running, true, "running from the press, before the record exists");
  const r = await pending;
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(seen, [{ fresh: true }]);
  assert.equal(s.running, true);
  assert.equal(s.driving, false, "this session watches; it does not drive");
});

test("a driver alive without a record yet is a run starting, not a failure", async () => {
  const { s } = sessionWith(async () => ({ ok: true, pid: process.pid }));
  const r = await s.startRun("cut-1");
  assert.deepEqual(r, { ok: true });
  assert.equal(s.running, true);
  assert.match(s.runNote ?? "", /is starting in its own process \(pid \d+\)/);
});

test("a driver gone before its record is a failure that says so", async () => {
  const { s } = sessionWith(async () => ({ ok: true, pid: 999999999 }));
  const r = await s.startRun("cut-1");
  assert.equal(r.ok, false);
  assert.equal(s.running, false);
  assert.match(s.runNote ?? "", /gone before it wrote its record/);
});

test("a driver that could not start leaves the reason on the note", async () => {
  const { s } = sessionWith(async () => ({ ok: false, reason: "the run driver is not built" }));
  const r = await s.startRun("cut-1");
  assert.equal(r.ok, false);
  assert.match(s.runNote ?? "", /could not start: the run driver is not built/);
  assert.equal(s.running, false);
});

test("a stop or an answer from a watching session goes through the record", async () => {
  const { s, dir } = sessionWith(async () => ({ ok: true }));
  saveRun(dir, { cutId: "cut-1", at: new Date().toISOString(), owner: { pid: process.pid, at: new Date().toISOString() }, state: "running" }, new RunState(() => {}));
  s.lookingAtCut = "cut-1";
  s.load();
  assert.equal(s.running, true);
  assert.equal(s.answerWorker("SL-1#eu-0", "the blue one"), true);
  assert.equal(s.stopRun(), 1);
  const record = JSON.parse(fs.readFileSync(path.join(dir, "runs", "cut-1.json"), "utf8")) as { answers?: unknown[]; stopRequestedAt?: string };
  assert.equal(record.answers?.length, 1);
  assert.ok(record.stopRequestedAt);
});
