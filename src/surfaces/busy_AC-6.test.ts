/**
 * INVARIANT — a space that changed recently is never called quiet:
 * busyLine says nothing about quiet minutes for a space whose last change
 * is newer than QUIET_MS. Otherwise every ordinary running build would be
 * misreported as stalled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceBusy, busyLine, QUIET_MS } from "./busy";

test("busyLine says nothing about quiet for a space that changed within QUIET_MS", () => {
  const now = Date.now();
  const lastChangeMs = now - Math.floor(QUIET_MS / 2);

  const session = {
    running: true,
    runState: { view: () => ({ units: [{ id: "u1", state: "running" }], parked: [] }) },
  };
  const space = spaceBusy("owner/fresh-space", "Fresh space", session, lastChangeMs);
  assert.ok(space, "a running session within QUIET_MS must be reported busy");

  const line = busyLine([space!], now);
  assert.ok(line, "a recently-changed busy space must still produce a busy line");
  assert.ok(!/quiet/i.test(line!.text), "the line must not mention quiet for a recently-changed space");
});
