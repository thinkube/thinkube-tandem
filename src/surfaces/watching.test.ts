/**
 * A window that watches a run it did not start keeps following it.
 *
 * Two processes see one run: the MCP server drives it and writes the
 * record; the editor window only reads that record. The editor adopted
 * the record ONCE and then stopped reading, because "a run is in flight"
 * and "I am the one running it" were the same flag. It froze on the
 * first snapshot it happened to catch — the one written the instant the
 * door finished, when no worker had started yet — so the worker graph
 * went blank at exactly the moment the workers appeared, and no later
 * write could bring it back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { RunState } from "../run/state";
import { saveRun } from "../run/record";

function watcher(): { session: TandemSession; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-watching-"));
  const session = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
  return { session, dir };
}

/** What the driver writes, as the driver: alive, and owned by this pid. */
function driverWrites(dir: string, units: { id: string; state: string }[]): void {
  const state = new RunState(() => {});
  for (const u of units) state.units.set(u.id, { id: u.id, label: u.id, state: u.state } as never);
  saveRun(
    dir,
    {
      cutId: "cut-1",
      at: new Date().toISOString(),
      state: "running",
      owner: { pid: process.pid, at: new Date().toISOString() },
    } as never,
    state,
  );
}

test("a watching window follows a running record it did not write, every time it loads", () => {
  const { session, dir } = watcher();

  // The instant the door finishes: the run is live, and has no workers yet.
  driverWrites(dir, []);
  session.load();
  assert.equal(session.running, true, "the watcher sees the run is in flight");
  assert.equal(session.runState?.units.size, 0);

  // Seconds later the driver has started the workers.
  driverWrites(dir, [
    { id: "u1", state: "running" },
    { id: "u2", state: "ready" },
  ]);
  session.load();
  assert.equal(
    session.runState?.units.size,
    2,
    "the graph fills in as the run proceeds — a watcher that adopted once showed nothing here",
  );
  assert.equal(session.driving, false, "watching is never driving");
});

test("the driving window never reads the record over its own state", () => {
  const { session, dir } = watcher();
  session.driving = true;
  session.running = true;
  session.runState = new RunState(() => {});
  session.runState.units.set("mine", { id: "mine", label: "mine", state: "running" } as never);

  driverWrites(dir, [{ id: "theirs", state: "done" }]);
  session.load();
  assert.deepEqual(
    [...(session.runState?.units.keys() ?? [])],
    ["mine"],
    "the driver's memory is ahead of the file it is still writing",
  );
});
