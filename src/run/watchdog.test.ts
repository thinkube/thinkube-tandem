/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A model round that streams is moving, even when it writes no line; a
 * round that sends nothing is not. The watch is wired the way the run wires
 * it: its own lines go through the run log, the same sink that counts beats.
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

function watchedRun(clock: ReturnType<typeof driven>) {
  const st = new RunState(() => {});
  const said: string[] = [];
  st.sink = (line) => said.push(line);
  const watch = watchForStall({
    st,
    units: () => [{ id: "SL-2#eu-0", state: "running", requires: [] }],
    log: (l) => st.log(l),
    defect: () => {},
    now: clock.now,
    every: clock.every,
  });
  return { st, said, watch };
}

test("a round that streams for ten minutes without a tool call is movement, and says so", () => {
  const clock = driven();
  const { st, said, watch } = watchedRun(clock);
  const round = watch.round("SL-2#eu-0");
  for (let i = 0; i < 20; i++) {
    clock.pass(30_000);
    round.heard();
  }
  round.ended();
  assert.equal(said.some((l) => l.includes("nothing has moved")), false, "no stall warning for a streaming round");
  assert.equal(st.halted, false);
  const notes = said.filter((l) => l.startsWith("still thinking — SL-2#eu-0, "));
  assert.deepEqual(
    notes,
    [
      "still thinking — SL-2#eu-0, 120s",
      "still thinking — SL-2#eu-0, 240s",
      "still thinking — SL-2#eu-0, 360s",
      "still thinking — SL-2#eu-0, 480s",
      "still thinking — SL-2#eu-0, 600s",
    ],
    "every two minutes the log says the round is still at work",
  );
});

test("a round that sends nothing is silence: warned, then stopped", () => {
  const clock = driven();
  const { st, said, watch } = watchedRun(clock);
  watch.round("SL-2#eu-0");
  for (let i = 0; i < 9; i++) clock.pass(60_000);
  assert.ok(said.some((l) => l.includes("nothing has moved")), "a silent round is warned about");
  assert.equal(said.some((l) => l.startsWith("still thinking")), false, "a round that sends nothing is not called thinking");
  assert.equal(st.halted, false, "a first silence is a notice");
  // The notice went through the run log; it is not itself movement.
  for (let i = 0; i < 9; i++) clock.pass(60_000);
  assert.equal(st.halted, true, "silence twice over stops the run");
});

test("a round that has ended is no longer said to be thinking", () => {
  const clock = driven();
  const { said, watch } = watchedRun(clock);
  const round = watch.round("SL-1#eu-0");
  clock.pass(60_000);
  round.heard();
  round.ended();
  clock.pass(120_000);
  assert.equal(said.some((l) => l.startsWith("still thinking")), false);
});
