/**
 * The invariant: **a run always ends.**
 *
 * Not "this deadlock does not happen again" — a run can fail to end in as
 * many ways as it has waits, and pinning each one costs a test and prevents
 * nothing. What must hold is the property: whatever the run is doing, and
 * whatever it says, it reaches a terminal state and reports.
 *
 * Two ways a run refuses to end, and the same watch answers both: it goes
 * quiet, or it talks forever while going nowhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";
import { watchForStall } from "./watchdog";

/** A clock and a tick the test drives by hand — no waiting, no flake. */
function driven(): { now: () => number; pass: (ms: number) => void; every: (fn: () => void, ms: number) => { stop: () => void } } {
  let t = 0;
  const ticks: (() => void)[] = [];
  return {
    now: () => t,
    every: (fn) => {
      ticks.push(fn);
      return { stop: () => ticks.splice(ticks.indexOf(fn), 1) };
    },
    pass: (ms) => {
      t += ms;
      for (const fn of [...ticks]) fn();
    },
  };
}

function watched(clock: ReturnType<typeof driven>, maxMs: number): { st: RunState; said: string[] } {
  const st = new RunState(() => {});
  const said: string[] = [];
  st.sink = (line) => said.push(line);
  watchForStall({
    st,
    units: () => [{ id: "SL-1#eu-0", state: "running", requires: [] }],
    log: (l) => said.push(l),
    defect: () => {},
    quietMs: 10 * 60_000,
    maxMs,
    now: clock.now,
    every: clock.every,
  });
  return { st, said };
}

test("a run that goes quiet ends, and says what never finished", () => {
  const clock = driven();
  const { st, said } = watched(clock, 60 * 60_000);
  clock.pass(11 * 60_000); // past the quiet limit: a notice, not yet an end
  assert.equal(st.halted, false, "a first silence is a notice, not an execution");
  clock.pass(11 * 60_000);
  assert.equal(st.halted, true, "silence twice over ends the run");
  assert.ok(
    said.some((l) => l.includes("SL-1#eu-0")),
    "and the report names the unit that never finished",
  );
});

test("a run that talks forever still ends at its bound", () => {
  const clock = driven();
  const { st, said } = watched(clock, 60 * 60_000);
  // A run in a repair loop: never silent, never finished.
  for (let i = 0; i < 20; i++) {
    st.log("round: still working");
    clock.pass(5 * 60_000);
  }
  assert.equal(st.halted, true, "the wall clock ends a run that silence never would");
  assert.ok(
    said.some((l) => l.includes("bound")),
    "and the report says it was the bound, not a stall",
  );
});
