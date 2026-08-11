import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RunState } from "./state";
import { loadLastRun, saveRun } from "./record";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "tandem-run-"));

test("a finished run is still there after the window that ran it has gone", () => {
  const dir = tmp();
  const state = new RunState(() => {});
  state.seed("u1", "SL-1", "test");
  state.seed("u2", "SL-1", "code", ["u1"]);
  state.set("u1", "done");
  state.set("u2", "failed");
  state.log("the check did not pass", "u2");
  saveRun(dir, { cutId: "cut-1", tepId: "TEP-7", at: "2026-08-09T22:00:00Z" }, state);

  const back = RunState.from(loadLastRun(dir)!, () => {});
  const view = back.view();
  assert.deepEqual(
    view.units.map((u) => [u.id, u.role, u.state]),
    [
      ["u1", "test", "done"],
      ["u2", "code", "failed"],
    ],
    "every worker, what kind it was and how it ended",
  );
  assert.equal(view.units[1].requires[0], "u1", "the order they ran in survives too");
  assert.ok(back.logTail("u2").lines.join("").includes("did not pass"), "and what it reported");
});

test("nothing is claimed to have run when nothing has", () => {
  assert.equal(loadLastRun(tmp()), undefined);
});

test("the newest run is the one shown", () => {
  const dir = tmp();
  const older = new RunState(() => {});
  older.seed("old", "SL-1", "code");
  saveRun(dir, { cutId: "cut-1", at: "2026-08-01T10:00:00Z" }, older);
  const newer = new RunState(() => {});
  newer.seed("new", "SL-2", "code");
  saveRun(dir, { cutId: "cut-2", at: "2026-08-09T10:00:00Z" }, newer);
  assert.equal(loadLastRun(dir)!.units[0].id, "new");
});

test("a run read back from disk has nobody left waiting on an answer", () => {
  const dir = tmp();
  const state = new RunState(() => {});
  state.seed("u1", "SL-1", "code");
  state.set("u1", "parked", "which name should I use?");
  saveRun(dir, { cutId: "cut-1", at: "2026-08-09T22:00:00Z" }, state);

  const back = RunState.from(loadLastRun(dir)!, () => {});
  assert.equal(back.view().parked.length, 0, "an unanswerable question must not be offered");
  assert.equal(back.view().units[0].question, undefined);
});
