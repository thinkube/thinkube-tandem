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
import {addAsk} from "../core/intent";

import { SHAPES, repoInShape, scriptedWorker , addNode} from "./shapes.fixture";
import type { RepoShape } from "./shapes.fixture";

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

/**
 * Every way a run can fail to stop.
 *
 * Silence, endless noise, and a repair that keeps trying without getting
 * better. Each ends at a bound and says what never finished, because a run
 * that hangs holds a person's evening and reports nothing at all.
 */
test("a run always ends — quiet, endless, or no longer improving", async () => {
  {
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
  }
  {
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
  }
  {
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
  }
});


/**
 * What a tree that does not build reports.
 *
 * One failure, not one per test that could not run. The compiler's own
 * words, because a paraphrase is not evidence. And the files it names are
 * what the closer is cleared to open — otherwise the actor sent to fix it
 * cannot reach the code that broke.
 */
test("a build failure is one failure, in the compiler's own words, and names its files", () => {
  {
  // The count a repair loop watches decides whether it keeps going. A
  // deletion that breaks five imports has done ONE thing wrong.
  assert.equal(convergenceScore({ buildRed: true, reds: 5 }), 1);
  assert.equal(convergenceScore({ buildRed: true, reds: 40 }), 1);
  assert.equal(convergenceScore({ buildRed: false, reds: 3 }), 3);
  }
  {
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
  }
  {
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
  }
});

/**
 * The closer and the finisher have full authority.
 *
 * They are the last actors before work is withheld, so a tool they lack is
 * work nobody can rescue. The rule was written for the closer and applied
 * to only half of it: the finisher kept its fence, and the argument for
 * removing one is the argument for removing both.
 */
test("the last actors are fenced by nothing — full authority is a fact, not a list", async () => {
  {
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
  }
  {
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
      told: { suite: "true" },
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
  }
});

/**
 * What must never be lost while a run is in flight.
 *
 * An actor that makes things worse before better is not cut off at the
 * worse round. What a unit wrote reaches the branch. A unit does not wait
 * on another slice for a break its own change caused. And a stop reaches
 * the last actor rather than leaving it running past the end.
 */
test("a unit's work survives a worse round, another slice's break, and a stop", async () => {
  {
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
  }
  {
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
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
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
  }
  {
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
  }
  {
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
  }
});


/**
 * Who a red belongs to.
 *
 * A check that was not there to run is the gate's business; an import a
 * check cannot resolve is genuinely the code's; a red in a file a unit may
 * not even open belongs to neither. Getting this wrong reworks and fails
 * units for breakage they had no hand in.
 */
test("a red is attributed to whoever can act on it, never to the nearest unit", async () => {
  {
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
      told: { suite: "true", ...(shape.runOne ? { runOne: shape.runOne } : {}) },
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
  }
  {
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
  }
  {
  // A module the coder never wrote fails exactly this way, and that red is
  // the verdict the run exists to give.
  const results = await runAcVerifications(
    [{ ac: 1, run: "node --test probes/a_AC-1.test.mjs", env: "local" }],
    "/nowhere",
    async () => ({ code: 1, output: "Error: Cannot find module '../out/greet.js'\nimported from probes/a_AC-1.test.mjs" }),
  );
  assert.equal(results[0].unrunnable, undefined, JSON.stringify(results[0]));
  }
});









/**
 * A unit that ends without a verdict says so, whichever way it ended.
 *
 * The attempt loop runs `while attempts remain AND the run is not halted`,
 * so a run that reaches its three-hour bound ends the loop of whatever
 * unit is in flight. That unit was then written down as a bare "failed"
 * with nothing beside it: no note, no line in the run's log, nothing to
 * tell it apart from work that was tried and judged. One run spent
 * fifty-five minutes on a unit that was still reading its brief when the
 * clock ran out, and reported it as the person's failure. The units
 * BLOCKED behind it said "the run stopped" — only the one actually
 * stopped said nothing.
 */
test("a unit is never failed in silence", () => {
  const st = new RunState(() => {});
  st.seed("SL-6#eu-0", "SL-6", "code");
  st.set("SL-6#eu-0", "running");

  // What the halted attempt loop does: it simply stops, and the unit is
  // finished as not-ok with no verdict of its own.
  st.set("SL-6#eu-0", "failed");

  const note = st.units.get("SL-6#eu-0")?.note ?? "";
  assert.notEqual(note, "", "a failure with nothing said is unreadable");
  assert.match(
    note,
    /not a verdict on the work/,
    "and it says the machine failed it, so nobody reads it as the person's",
  );
});

test("a unit failed for a real reason keeps that reason", () => {
  const st = new RunState(() => {});
  st.seed("SL-18#eu-0", "SL-18", "code");
  st.fail("SL-18#eu-0", "checks not green after 2 attempts and the closer");
  st.set("SL-18#eu-0", "failed");
  assert.match(st.units.get("SL-18#eu-0")?.note ?? "", /checks not green/, "the true reason is never overwritten");
});

/**
 * A long run is not a broken run.
 *
 * The watch used to hold a three-hour clock and stop the run at it,
 * whatever was happening. It stopped one that was working: thirty-three
 * of forty-one units finished, eight never started, and every verdict was
 * thrown away for being slow. Nothing in a run is unbounded to begin
 * with — attempts, challenges, repairs and turns all have limits, execs
 * time out, the plan is a finite graph — so time alone was never evidence
 * of anything, and no deadline is set by default. Going quiet still ends
 * a run, because a silent run is one nobody can read.
 */
test("a run that keeps talking is never stopped for taking long", () => {
  const clock = driven();
  const st = new RunState(() => {});
  const said: string[] = [];
  st.sink = (line) => said.push(line);
  watchForStall({
    st,
    units: () => [{ id: "SL-1#eu-0", state: "running", requires: [] }],
    log: (l) => said.push(l),
    defect: () => {},
    quietMs: 10 * 60_000,
    now: clock.now,
    every: clock.every,
  });

  // Eight hours of a run that is working: something is said every minute.
  for (let i = 0; i < 8 * 60; i++) {
    st.log("still working");
    clock.pass(60_000);
  }
  assert.equal(st.halted, false, "a working run is left alone, however long it takes");
  assert.equal(
    said.some((l) => l.includes("bound")),
    false,
    "and nothing is said about a bound, because it has none",
  );
});

test("a caller that insists on a deadline still gets one", () => {
  const clock = driven();
  const { st } = watched(clock, 60 * 60_000);
  for (let i = 0; i < 70; i++) {
    st.log("still working");
    clock.pass(60_000);
  }
  assert.equal(st.halted, true, "an explicit deadline is honoured");
});
