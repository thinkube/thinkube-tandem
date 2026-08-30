/**
 * INVARIANT — a space that is gone must never haunt the busy line: the line
 * built from the set of currently-open spaces says nothing about a space
 * that is no longer among them, even when a change time was recorded for
 * it earlier. This is the caller-side contract that lets extension.ts drop
 * a closed space's session, panel and last-change time in one act without
 * the busy line still counting its quiet minutes forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceBusy, busyLine, QUIET_MS } from "./busy";

test("busyLine never names a space that is no longer in the open-spaces list", () => {
  const now = Date.now();
  const goneLastChangeMs = now - QUIET_MS - 60 * 60_000;

  const stillOpenSession = {
    running: true,
    runState: { view: () => ({ units: [{ id: "u1", state: "running" }], parked: [] }) },
  };

  // The closed space's own change time is still old and stale, but it is
  // simply never passed into busyLine because it is no longer open — the
  // caller (extension.ts) drops it from the map before building the line.
  const goneSpace = spaceBusy("owner/gone-space", "Gone space", stillOpenSession, goneLastChangeMs);
  assert.ok(goneSpace, "sanity: the fixture itself would read as busy while still open");

  const stillOpen = spaceBusy("owner/still-open", "Still open", stillOpenSession);
  assert.ok(stillOpen, "the remaining open space must be reported busy");

  // Only the still-open space is handed to busyLine — the closed one has
  // already been dropped by the caller and never appears in the list.
  const line = busyLine([stillOpen!], now);
  assert.ok(line, "the remaining open space must still produce a busy line");
  assert.ok(!line!.text.includes("Gone space"), "the line must never name a space that is no longer open");
  assert.ok(!(line!.detail ?? "").includes("Gone space"), "the detail must never name a space that is no longer open");
});
