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
import { repairSuiteAtGate } from "./gateRepair";
import { buildComplaint } from "./setup";
import { filesNamedIn } from "./suite";
import { confirmWaitingForTree } from "./repair";
import { runAcVerifications } from "../engine/core/closingGate";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

test("the closer is fenced by nothing — full authority is a fact, not a list", async () => {
  // Two runs withheld because the closer wrote the correct fix in a file
  // its clearance list did not contain, and the guard deleted the edit. A
  // list can never hold the file the closer discovers by reading; behind
  // the last actor nobody runs, so there is nothing a fence protects.
  let sawUnfenced: boolean | undefined;
  await close({
    subject: "the delivery",
    worktree: "/nowhere",
    footprint: ["src/a.ts"],
    probeSources: [],
    history: [],
    criteria: [{ id: "c1", text: "it works" }],
    model: "sonnet",
    measure: (() => {
      let n = 0;
      return async () => ({ green: n++ > 0, score: n > 1 ? 0 : 1, evidence: "" });
    })(),
    exec: async () => ({ code: 0, out: "" }),
    boundedExec: async () => ({ code: 0, output: "" }),
    halted: () => false,
    log: () => {},
    say: () => {},
    onRuling: () => {},
    defect: () => {},
    worker: async (deps) => {
      sawUnfenced = (deps as { unfenced?: boolean }).unfenced;
      return { ok: true, finalText: "done" };
    },
  });
  assert.equal(sawUnfenced, true, "the guard does not run over the closer");
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
      suiteCommand: ["true"],
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
      suiteCommand: ["true"],
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

test("the closer is cleared for the files the compiler names", () => {
  // The gate's last actor had "full authority" and had its edit restored by
  // the guard, because the clearance was read from the TEST failures only
  // and the tree's real problem was a compiler error in another file.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-named-"));
  fs.mkdirSync(path.join(repo, "src", "core"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "core", "records.ts"), "export const x = 1;\n");
  const out =
    "src/core/records.ts(96,10): error TS2305: Module has no exported member 'foldSpaces'.\n" +
    "src/gone/away.ts(1,1): error TS2307: file that does not exist here\n";
  assert.deepEqual(filesNamedIn(out, repo), ["src/core/records.ts"], "named, and only what really exists");
});

/**
 * A red that says "the check was not there to run" is the gate's failure,
 * never a code verdict. Eight runs once wrote 460 code rows whose single
 * cause was the machine judging a tree its checks were not in — and the
 * attention counter saw none of it, because a missing check exits like an
 * ordinary failure.
 */
test("a check that was not there to run is the gate's red, not the code's", async () => {
  const results = await runAcVerifications(
    [
      { ac: 1, run: "node --test probes/a_AC-1.test.mjs", env: "local" },
      { ac: 2, run: "node --test probes/b_AC-2.test.mjs", env: "local" },
    ],
    "/nowhere",
    async (run) =>
      run.includes("a_AC-1")
        ? { code: 1, output: "Could not find '/wt/probes/a_AC-1.test.mjs'" }
        : { code: 1, output: "not ok 1 - greet returns hello\n  AssertionError: expected 'hello'" },
  );
  assert.equal(results[0].unrunnable, true, "a missing check is the gate's own failure");
  assert.equal(results[1].unrunnable, undefined, "a check that ran and failed is the honest code red");
});

test("an import the check cannot resolve stays a code red", async () => {
  // A module the coder never wrote fails exactly this way, and that red is
  // the verdict the run exists to give.
  const results = await runAcVerifications(
    [{ ac: 1, run: "node --test probes/a_AC-1.test.mjs", env: "local" }],
    "/nowhere",
    async () => ({ code: 1, output: "Error: Cannot find module '../out/greet.js'\nimported from probes/a_AC-1.test.mjs" }),
  );
  assert.equal(results[0].unrunnable, undefined, JSON.stringify(results[0]));
});

test("a unit never waits on another slice for a build its own change broke", async () => {
  // The runner holds the base, which builds, plus this unit's files: a
  // build error outside its clearance is its own doing, and waiting for
  // another slice to mend it is waiting for nobody.
  let waited = 0;
  const result = {
    kind: "build-failed" as const,
    testFault: false,
    errorFiles: ["src/extension.ts"],
    output: "src/extension.ts(10,3): error TS2554: Expected 2 arguments, but got 1.",
  };
  const r = await confirmWaitingForTree({
    oracle: { confirmGreen: async () => ({ green: false, result }) } as never,
    slice: "SL-6",
    repair: (async () => []) as never,
    halted: () => false,
    footprint: ["src/surfaces/spaceTabs.ts"],
    pendingPlanned: () => [],
    othersPending: () => true,
    waitForCommit: async () => {
      waited++;
    },
    say: () => {},
  });
  assert.equal(waited, 0, "no wait was taken");
  assert.equal(r.green, false, "and the verdict is the unit's to act on");
});

test("Stop reaches the closer — its abort is handed to the run", async () => {
  // Every other actor registers its abort the moment it starts. The closer
  // never did, and it is the one that runs longest and last: pressing Stop
  // during it aborted nothing and reported "Nothing to stop", while the
  // halt flag it does read is only read between rounds. Twenty minutes of
  // a person asking why the button did nothing.
  const handed: AbortController[] = [];
  await close({
    subject: "the delivery",
    worktree: "/nowhere",
    footprint: ["src/a.ts"],
    probeSources: [],
    history: [],
    criteria: [{ id: "c1", text: "it works" }],
    model: "sonnet",
    measure: (() => {
      let n = 0;
      return async () => ({ green: n++ > 0, score: n > 1 ? 0 : 1, evidence: "" });
    })(),
    exec: async () => ({ code: 0, out: "" }),
    boundedExec: async () => ({ code: 0, output: "" }),
    halted: () => false,
    abortable: (ab) => handed.push(ab),
    log: () => {},
    say: () => {},
    onRuling: () => {},
    defect: () => {},
    worker: async (deps) => {
      // The controller the run was handed is the one the worker runs under.
      assert.ok(handed.includes((deps as { abort: AbortController }).abort), "a different controller was handed out");
      return { ok: true, finalText: "done" };
    },
  });
  assert.ok(handed.length >= 1, "the closer never offered its abort to the run");
});

test("the finisher is fenced by nothing either — the argument was only half applied", async () => {
  // The reason the closer is unfenced holds for the finisher word for word:
  // the guard keeps PARALLEL workers off each other's files, and at the gate
  // nobody runs beside it. Fenced, it spent six minutes discovering it could
  // not write the file its own red named, failed, and the closer — allowed
  // to — fixed the same red in one round.
  let sawUnfenced: boolean | undefined;
  const state = new RunState(() => {});
  await repairSuiteAtGate({
    tep: "TEP-1",
    worktree: "/nowhere",
    baseSha: "HEAD~1",
    state,
    verdict: { green: false, failures: [{ name: "a standing check", file: "docs/LEDGER.md", detail: "stale" }] },
    deps: {
      suiteCommand: ["true"],
      worker: async (d: { unfenced?: boolean }) => {
        sawUnfenced = d.unfenced;
        return { ok: true, finalText: "done" };
      },
    } as never,
    exec: async () => ({ code: 0, out: "" }),
    suiteExec: async () => ({ code: 1, output: "still red" }),
    log: () => {},
    defect: () => {},
  } as never);
  assert.equal(sawUnfenced, true, "the guard still runs over the last actor at the gate");
});

test("a build that fails at the gate says what the compiler said", () => {
  // This reported the LAST line of the output, and a compiler's output
  // ends in a blank line — so a run withheld ten promises with the words
  // "checks run against an unbuilt tree:" and nothing after the colon.
  // The closer spent rounds guessing at a message nobody had shown it.
  const tsc = [
    "",
    "> thinkube-tandem@2.0.1 compile",
    "> tsc -p ./",
    "",
    "src/run/state.ts(41,3): error TS2564: Property 'plan' has no initializer.",
    "src/gates/render.ts(88,7): error TS2322: Type 'string' is not assignable.",
    "",
    "",
  ].join("\n");
  const said = buildComplaint(tsc);
  assert.match(said, /state\.ts\(41,3\): error TS2564/);
  assert.match(said, /render\.ts\(88,7\)/);
  assert.doesNotMatch(said, /^\s*$/, "a failure that says nothing is the defect this replaces");
  // Output with no error-shaped line still says something rather than nothing.
  assert.equal(buildComplaint("\n\nkilled by signal\n\n"), "killed by signal");
  assert.match(buildComplaint("\n\n\n"), /printed nothing/);
});
