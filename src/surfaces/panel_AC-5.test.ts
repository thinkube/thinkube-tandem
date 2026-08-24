/**
 * With several thinking spaces open at once, the status line must report
 * every space's activity, not hide the rest behind whichever one is
 * active: a session parked on a question always needs a person's
 * attention, and that must remain visible even while another space's
 * session is still building — neither state may swallow the other.
 *
 * STANDING INVARIANT — across the open sessions, a session whose run has a
 * parked unit is always distinguishable, through its own runState.view(),
 * from a session whose run is still building with nothing parked; reading
 * one session's state must never depend on, or erase, the other's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession, SessionDeps } from "./session";
import { RunState } from "../run/state";

function fakeDeps(dir: string): SessionDeps {
  return {
    round: { model: "fake-model", repoRoot: dir },
    storeDir: path.join(dir, "store"),
    storageDir: path.join(dir, "storage"),
    now: () => "2026-08-24T00:00:00Z",
    author: "t",
  };
}

test("a status line built from two sessions, one building and one parked on a question, must report both states rather than only one", () => {
  const dirBuilding = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-status-building-"));
  const dirParked = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-status-parked-"));
  const building = new TandemSession(fakeDeps(dirBuilding));
  const parked = new TandemSession(fakeDeps(dirParked));

  building.running = true;
  building.runState = new RunState(() => {});
  building.runState.seed("u1", "SL-1", "code");
  building.runState.set("u1", "running");

  parked.running = true;
  parked.runState = new RunState(() => {});
  parked.runState.seed("u2", "SL-2", "code");
  parked.runState.park("u2", "which file should this land in?", () => {});

  const all = [building, parked];

  // The line for several open spaces must be able to tell these two states
  // apart — a worker waiting for a person is never the same fact as a
  // worker still running — and it must see BOTH sessions, not just one.
  const withParked = all.filter(
    (s) => s.running && s.runState && s.runState.view().parked.length > 0,
  );
  const stillBuilding = all.filter(
    (s) => s.running && s.runState && s.runState.view().parked.length === 0,
  );

  assert.deepEqual(withParked, [parked], "the parked session must be reported as needing an answer");
  assert.deepEqual(withParked.length, 1);
  assert.deepEqual(stillBuilding, [building], "the building session must still be reported, not hidden by the parked one");
  assert.deepEqual(stillBuilding.length, 1);

  // Reading the parked session's view must not have disturbed the building
  // session's own state, and vice versa.
  assert.equal(building.runState.view().parked.length, 0);
  assert.equal(parked.runState.view().parked.length, 1);
});
