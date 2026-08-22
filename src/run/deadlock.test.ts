/**
 * Two slices, one shared file, and a wait — the shape every deadlock this
 * product has met is made of, and the one shape no test could reach.
 *
 * The harness ran one slice with one file, so the scheduler's rule — never
 * launch a unit while another running unit holds one of its files — was
 * never exercised, and the ten-minute waits were real sleeps no test could
 * enter. Both of this week's deadlocks lived in exactly that gap:
 *
 *  - v2.0.134: units waited for units queued behind them.
 *  - v2.0.138: units waited for units the scheduler could never launch,
 *    because each shared a file with one of the sleepers.
 *
 * Here the wait is driven by an injected clock, so ten minutes pass in no
 * time and a run that would have sat for hours either finishes or fails a
 * test. The assertion is not about which path it takes: it is that the run
 * ENDS, and that nothing waits more times than there is anything to wait
 * for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dispatchTep } from "./dispatch";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { emptySpace } from "../core/schema";
import { addAsk, addNode } from "../core/intent";
import { MIRROR_STRIPPED, repoInShape } from "./shapes";
import type { WorkerOutcome } from "./worker";

/** Two promises that land in two files, and BOTH touch the same third file
 *  — the ordinary shape of a feature, and the one that serialises them. */
function twoSlicesSharingAFile(): { space: ReturnType<typeof emptySpace>; ids: string[] } {
  let s = emptySpace();
  const a = addAsk(s, "greet the user, and remember who was greeted", "t");
  assert.ok(a.ok);
  s = a.space;
  const one = addNode(s, {
    sentence: "a greet module",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
    grounding: {
      touchpoints: [
        { path: "src/greet.mjs", planned: true },
        { path: "src/shared.mjs", planned: false },
      ],
      stamp: [],
    },
  });
  assert.ok(one.ok);
  s = one.space;
  const two = addNode(s, {
    sentence: "a memory of greetings",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c2", text: "remember() keeps the last name" }],
    grounding: {
      touchpoints: [
        { path: "src/memory.mjs", planned: true },
        { path: "src/shared.mjs", planned: false },
      ],
      stamp: [],
    },
  });
  assert.ok(two.ok);
  return { space: two.space, ids: [one.added.id, two.added.id] };
}

/** A worker that writes what its unit is for. Checks are written to pass
 *  once the module exists; production is written plainly. */
function honestWorker(skip?: string): (deps: { role: string; worktree: string; footprint: string[] }, brief: string) => Promise<WorkerOutcome> {
  const write = (root: string, rel: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  return async (deps) => {
    for (const rel of deps.footprint) {
      if (rel.startsWith("probes/")) {
        const subject = /SL-1/.test(rel) ? "greet" : "remember";
        write(
          deps.worktree,
          rel,
          `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
            `import { ${subject} } from "../out/${subject === "greet" ? "greet" : "memory"}.mjs";\n` +
            `test("${subject}", () => assert.ok(${subject}()));\n`,
        );
        continue;
      }
      if (rel.endsWith("greet.mjs")) write(deps.worktree, rel, `export function greet() { return "hello"; }\n`);
      if (rel.endsWith("memory.mjs") && skip !== "memory") write(deps.worktree, rel, `export function remember() { return "who"; }\n`);
      if (rel.endsWith("shared.mjs")) write(deps.worktree, rel, `export const shared = true;\n`);
    }
    return { ok: true, finalText: "done" };
  };
}

test("REGRESSION: two slices sharing a file, with a standing red the plan will never clear — the run ends instead of waiting for itself", async () => {
  // The shape: a standing test that imports the module SL-2 will create, so
  // until SL-2 lands it the suite is red in the exact words the machine
  // reads as "the tree is not ready yet" — the one red that makes a unit
  // wait. And the two slices share src/shared.mjs, so while one runs the
  // other cannot start. Under the old rules SL-1 slept twelve times waiting
  // for a unit that could not begin until SL-1 stopped.
  //
  // Which slice the scheduler picks first is its own business, and only the
  // SL-1-first order produces the shape. So the fixture runs until it sees
  // it — a second or two each — and refuses to pass on an order that proves
  // nothing.
  let log = "";
  let waits = 0;
  let outcome: Awaited<ReturnType<typeof dispatchTep>> | undefined;
  let state = new RunState(() => {});
  for (let attempt = 1; attempt <= 4 && !/\[tree\]/.test(log); attempt++) {
    const repo = repoInShape(MIRROR_STRIPPED, { waitsFor: "out/memory.mjs" });
    fs.writeFileSync(path.join(repo, "src", "shared.mjs"), `export const shared = false;\n`);
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "shared"]);
    const { space, ids } = twoSlicesSharingAFile();
    const cut = { id: "cut-1", changeIds: ids, tepId: `TEP-deadlock-${attempt}` };
    state = new RunState(() => {});
    waits = 0;
    outcome = await dispatchTep(
      {
        repoRoot: repo,
        model: "sonnet",
        suiteCommand: ["node", "-e", "process.exit(0)"],
        prepare: MIRROR_STRIPPED.prepare,
        runOne: MIRROR_STRIPPED.runOne,
        suiteReds: ["src/link.test.mjs"],
        state,
        supervisorRound: async () => null,
        rehome: async () => ({ anchors: [], notes: [] }),
        spaceName: "deadlock",
        // The test's clock: ten minutes pass in no time, and every wait is
        // counted. A run that waits more than a few times is waiting for
        // itself, and the test says so instead of hanging.
        waitSleep: async () => {
          waits++;
          assert.ok(waits <= 24, `the run waited ${waits} times: it is waiting for itself`);
        },
        worker: honestWorker() as never,
      } as never,
      space,
      cut,
      tepSlices({ space, cut, spaceName: "deadlock" }),
    );
    log = [...state.logs].join("\n");
    if (process.env.TANDEM_DEBUG) console.log(log);
  }

  assert.match(log, /\[tree\]/, "no attempt produced the shape under test — the fixture proves nothing");
  // The answer to that red must be: do not sleep. The only unit that could
  // land the module shares a file with this one and cannot start while it
  // runs, so every minute waiting is spent waiting on itself. A look or two
  // is a decision; twelve is a deadlock.
  const slept = log.split("\n").filter((l) => l.includes("⏳")).length;
  assert.ok(slept <= 2, `it slept ${slept} times on a unit that cannot start while this one holds the file`);
  assert.ok(waits <= 2, `the clock was asked for ${waits} waits`);
  const open = [...state.units.values()].filter((u) => u.state === "running" || u.state === "ready");
  assert.deepEqual(open.map((u) => u.id), [], "no unit is left running when the run returns");
  assert.ok(
    outcome?.delivery || outcome?.refusals.length || outcome?.undelivered.length,
    "and it ended with something to read: a delivery, a refusal, or named undelivered work",
  );
});

test("the stall watchdog: a run that goes silent names every open unit and stops itself", async () => {
  const { watchForStall } = await import("./watchdog");
  const lines: string[] = [];
  const st = new RunState(() => {});
  st.seed("SL-1#eu-0", "SL-1", "code", [], undefined, []);
  st.set("SL-1#eu-0", "running");
  st.doing("SL-1#eu-0", "waiting on another unit's files");
  let clock = 0;
  let fire: () => void = () => {};
  const watch = watchForStall({
    st,
    units: () => [...st.units.values()],
    log: (l) => void lines.push(l),
    defect: () => {},
    quietMs: 1000,
    now: () => clock,
    every: (fn) => ((fire = fn), { stop: () => {} }),
  });
  clock = 500;
  fire();
  assert.deepEqual(lines, [], "a run that has been quiet for a moment is not a stalled run");
  clock = 2000;
  fire();
  assert.match(lines.join("\n"), /nothing has moved for 2 seconds/);
  assert.match(lines.join("\n"), /SL-1#eu-0: running — waiting on another unit's files/, "it names what is open");
  assert.equal(st.halted, false, "the first word is a notice, not a stop");
  clock = 4000;
  fire();
  assert.match(lines.join("\n"), /stopping itself/);
  assert.equal(st.halted, true, "a run that cannot move ends itself instead of sitting");
  watch.stop();
});

test("REGRESSION (v2.0.140): a standing red the machine says is nobody's here never fails a unit whose own checks are green", async () => {
  // What happened this morning: four units, every probe green — 6/6, 7/7,
  // 7/7, 6/6 — and one `knip` line red, which the run itself labelled "a
  // file another unit will still create". Each unit waited, reworked twice,
  // went to the closer, and failed. The closers read the evidence, agreed it
  // was not theirs, said so, and the units failed anyway. The machine knew
  // the answer and did the opposite.
  //
  // Here the standing test imports the module SL-2 is planned to create —
  // so the red is labelled "tree", exactly as knip's was — and SL-2's worker
  // never writes it. The red can never clear. SL-2 fails on its own checks,
  // honestly. SL-1, green on all of its own, must not.
  let log = "";
  let state = new RunState(() => {});
  let outcome: Awaited<ReturnType<typeof dispatchTep>> | undefined;
  for (let attempt = 1; attempt <= 4 && !/\[tree\]/.test(log); attempt++) {
    const repo = repoInShape(MIRROR_STRIPPED, { waitsFor: "out/memory.mjs" });
    const { space, ids } = twoSlicesSharingAFile();
    const cut = { id: "cut-1", changeIds: ids, tepId: `TEP-notmine-${attempt}` };
    state = new RunState(() => {});
    outcome = await dispatchTep(
      {
        repoRoot: repo,
        model: "sonnet",
        suiteCommand: ["node", "-e", "process.exit(0)"],
        prepare: MIRROR_STRIPPED.prepare,
        runOne: MIRROR_STRIPPED.runOne,
        suiteReds: ["src/link.test.mjs"],
        state,
        supervisorRound: async () => null,
        rehome: async () => ({ anchors: [], notes: [] }),
        spaceName: "notmine",
        waitSleep: async () => {},
        worker: honestWorker("memory") as never,
      } as never,
      space,
      cut,
      tepSlices({ space, cut, spaceName: "notmine" }),
    );
    log = [...state.logs].join("\n");
    if (process.env.TANDEM_DEBUG) console.log(log);
  }
  assert.match(log, /\[tree\]/, "no attempt produced the shape under test — the fixture proves nothing");
  const failed = [...state.units.values()].filter((u) => u.state === "failed");
  assert.deepEqual(
    failed.filter((u) => u.id.startsWith("SL-1")).map((u) => `${u.id}: ${u.note ?? ""}`),
    [],
    "the unit green on every one of its own checks does not die for a red the machine said was not its own",
  );
  assert.ok(outcome?.delivery, "the run reaches a delivery, which carries the red for the gate to hold");
});
