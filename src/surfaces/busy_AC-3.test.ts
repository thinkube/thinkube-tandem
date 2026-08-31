/**
 * INVARIANT — a parked worker always raises the alert, even when another
 * space is merely running: busyLine sets alert to true and includes an
 * explicit phrase such as "needs an answer" when any space in the list has
 * a parked worker. A person must never miss a worker waiting on them just
 * because some other space is quietly building.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceBusy, busyLine } from "./busy";

test("a parked worker in any space sets alert and names the need for an answer", () => {
  const runningOnly = {
    running: true,
    runState: {
      view: () => ({
        units: [{ id: "SL-1#eu-1", state: "running" }],
        parked: [],
      }),
    },
  };
  const parkedSession = {
    running: true,
    runState: {
      view: () => ({
        units: [{ id: "SL-2#eu-1", state: "running" }],
        parked: [{ unitId: "SL-2#eu-1", question: "which flag?" }],
      }),
    },
  };

  const running = spaceBusy("owner/running-space", "Running space", runningOnly);
  const parked = spaceBusy("owner/parked-space", "Parked space", parkedSession);
  assert.ok(running, "the merely-running space must still be reported busy");
  assert.ok(parked, "the space with a parked worker must be reported busy");

  const line = busyLine([running!, parked!], Date.now());
  assert.ok(line, "a parked worker must produce a busy line");
  assert.equal(line!.alert, true, "a parked worker anywhere in the list must set alert true");
  assert.ok(
    line!.text.includes("needs an answer"),
    "the line must contain the literal phrase 'needs an answer' (or an equivalent literal substring)",
  );
});
