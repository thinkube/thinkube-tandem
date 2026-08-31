/**
 * INVARIANT — a space that has gone quiet says so in minutes: busyLine
 * appends how many minutes a space has been quiet once its last recorded
 * change is older than QUIET_MS. A person must be able to tell a stalled
 * space from one that is merely between updates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceBusy, busyLine, QUIET_MS } from "./busy";

test("busyLine names how many minutes a space has been quiet past QUIET_MS", () => {
  const now = Date.now();
  const quietMinutes = 12;
  const lastChangeMs = now - QUIET_MS - quietMinutes * 60_000;

  const session = {
    running: true,
    runState: { view: () => ({ units: [{ id: "u1", state: "running" }], parked: [] }) },
  };
  const space = spaceBusy("owner/quiet-space", "Quiet space", session, lastChangeMs);
  assert.ok(space, "a running session past QUIET_MS must still be reported busy");

  const line = busyLine([space!], now);
  assert.ok(line, "a quiet busy space must still produce a busy line");
  assert.ok(/quiet/i.test(line!.text), "the line must say the space has gone quiet");
  assert.ok(/\d+\s*min/i.test(line!.text), "the line must state the number of quiet minutes");
});
