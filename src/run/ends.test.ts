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
import { close, convergenceScore } from "./closer";
import { execFileSync } from "node:child_process";
import { dispatchTep } from "./dispatch";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { SHAPES, repoInShape, scriptedWorker } from "./shapes";
import type { RepoShape } from "./shapes";

/** One ask, one promise, one criterion — the content is never the point. */
function oneAsk(): { space: ReturnType<typeof emptySpace>; ids: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "greet the user", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, ids: [n.added.id] };
}

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

/**
 * Convergence: the loop must end, and it must not end by abandoning a
 * repair halfway through a structural change.
 */
test("a tree that does not build is one failure, not many", () => {
  // The count a repair loop watches decides whether it keeps going. A
  // deletion that breaks five imports has done ONE thing wrong.
  assert.equal(convergenceScore({ buildRed: true, reds: 5 }), 1);
  assert.equal(convergenceScore({ buildRed: true, reds: 40 }), 1);
  assert.equal(convergenceScore({ buildRed: false, reds: 3 }), 3);
});

test("demolition is not punished: the closer rides out a worse round and finishes", async () => {
  // The real loop, over a repair that gets WORSE before it gets better —
  // a deletion that breaks imports for a round, which is what a structural
  // change looks like from the outside.
  const scores = [4, 9, 6, 0];
  let round = -1;
  const said: string[] = [];
  const result = await close({
    subject: "the delivery",
    worktree: "/nowhere",
    footprint: ["src/a.ts"],
    probeSources: [],
    history: [],
    criteria: [{ id: "c1", text: "it works" }],
    model: "sonnet",
    measure: async () => {
      round++;
      const score = scores[Math.min(round, scores.length - 1)];
      return { green: score === 0, score, evidence: `${score} red` };
    },
    exec: async () => ({ code: 0, out: "" }),
    boundedExec: async () => ({ code: 0, output: "" }),
    halted: () => false,
    log: (l) => said.push(l),
    say: () => {},
    onRuling: () => {},
    defect: () => {},
    worker: async () => ({ ok: true, finalText: "working" }),
  });

  assert.equal(result.green, true, "the repair that ends green is not abandoned on its worst round");
  assert.ok(result.rounds >= 2, `it took more than one round: ${result.rounds}`);
});

test("a repair that stops improving does end", async () => {
  const result = await close({
    subject: "the delivery",
    worktree: "/nowhere",
    footprint: ["src/a.ts"],
    probeSources: [],
    history: [],
    criteria: [{ id: "c1", text: "it works" }],
    model: "sonnet",
    measure: async () => ({ green: false, score: 5, evidence: "5 red" }),
    exec: async () => ({ code: 0, out: "" }),
    boundedExec: async () => ({ code: 0, output: "" }),
    halted: () => false,
    log: () => {},
    say: () => {},
    onRuling: () => {},
    defect: () => {},
    worker: async () => ({ ok: true, finalText: "no idea" }),
  });
  assert.equal(result.green, false);
  assert.ok(result.rounds <= 3, `it stopped instead of grinding: ${result.rounds} rounds`);
});

/**
 * Two more invariants, stated as properties rather than as the incidents
 * that taught them.
 */
test("a unit is never failed for a red it cannot reach", async () => {
  // A standing test of the repository is already red, in a file no unit of
  // this cut is cleared to change. Four units were once reworked, closed
  // and failed for exactly this.
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape, { standingRed: true });
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-unreachable" };
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state,
      supervisorRound: async () => null,
      spaceName: "ends",
      worker: scriptedWorker(shape, "honest").worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "ends" }),
  );

  assert.deepEqual(
    [...state.units.values()].filter((u) => u.state === "failed").map((u) => `${u.id}: ${u.note ?? ""}`),
    [],
    "no unit was failed for the standing red it could not reach",
  );
  assert.ok(outcome.delivery, "and the run still reached a delivery");
});

test("nothing a unit wrote is lost from the branch", async () => {
  // Even when the promise is not kept: the work stays where a person can
  // pick it up, and the delivery says so.
  const shape = SHAPES[0] as RepoShape;
  const repo = repoInShape(shape);
  const { space, ids } = oneAsk();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-kept-work" };
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      ...(shape.runOne ? { runOne: shape.runOne } : {}),
      state,
      supervisorRound: async () => null,
      spaceName: "ends",
      worker: scriptedWorker(shape, "unchanging", false).worker as never,
    } as never,
    space,
    cut,
    tepSlices({ space, cut, spaceName: "ends" }),
  );

  assert.ok(outcome.delivery?.withheld, "the promise was not kept");
  const onBranch = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", outcome.delivery!.branch])
    .toString()
    .split("\n");
  assert.ok(onBranch.includes("src/greet.mjs"), `the work the coder wrote is on the branch: ${onBranch.join(" ")}`);
});
