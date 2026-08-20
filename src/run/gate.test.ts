/**
 * The closing gate's promises, driven end to end through dispatchTep over a
 * real temporary repository: the repository's own suite decides, and a red
 * suite is never delivered — withheld, with the reason in intent terms.
 */
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { dispatchTep } from "./dispatch";
import { RED_SUITE_REFUSAL } from "./gate";
import { RunState } from "./state";
import { tepSlices } from "../dispatch/adapter";
import { GREEN_PROBE, spaceWithOneChange, tmpRepo, writeInto } from "./runHarness";

test("a red suite after the work withholds the delivery, in intent terms — never handed over red", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-33" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      // Green on the untouched tree, red once the work exists: a standing check the work breaks.
      suiteCommand: ["node", "-e", "process.exit(require('fs').existsSync('src/greet.mjs') ? 1 : 0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        // Neither the finisher nor the closer can help here: the standing
        // check is red for as long as the work exists — a break nothing can undo.
        if (/FINISHER|You are the CLOSER/.test(brief))
          return { ok: true, finalText: "UNDELIVERED: the check forbids the work itself" };
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.deepEqual(outcome.refusals, [RED_SUITE_REFUSAL]);
  assert.ok(outcome.delivery?.withheld?.startsWith(RED_SUITE_REFUSAL), "the withheld delivery is on the record, with why");
  assert.match(outcome.delivery!.withheld!, /still red: the suite exited with code 1/, "and it names what stayed red");
  const finisher = [...state.units.values()].filter((u) => u.id.startsWith("gate#suite-"));
  assert.ok(finisher.length >= 1 && finisher.every((u) => u.state === "failed"), "the finisher tried, on the record, and could not");
  assert.ok(outcome.delivery!.proofs.some((p) => p.kind === "suite" && p.verdict === "red"), "its proofs are readable");
  assert.equal(outcome.url, undefined, "nothing was opened");
  assert.ok(!/\.(mjs|ts|js)\b/.test(RED_SUITE_REFUSAL), "the reason names no file — the human is not asked about internals");
});

const SUITE_WANTS_FINISHED = [
  "node",
  "-e",
  [
    "const fs=require('fs');",
    "const ok=fs.existsSync('src/greet.mjs')&&fs.readFileSync('src/greet.mjs','utf8').includes('finished');",
    "if(ok){console.log('ok 1 - greet is finished\\n# tests 1\\n# pass 1\\n# fail 0');process.exit(0)}",
    "console.log(\"not ok 1 - greet is finished\\n  ---\\n  location: '/x/out-test/greet.test.js:3:1'\\n  error: |-\\n    src/greet.mjs must say finished\\n  ...\\n# tests 1\\n# pass 0\\n# fail 1\");",
    "process.exit(1)",
  ].join(""),
];

test("the repository's standing tests are the coder's check too, scoped to what imports its files: told which one its tree breaks, the coder fixes it before it is done", async () => {
  const repo = tmpRepo();
  // A standing test of the repository, on the base, that imports the slice's file.
  writeInto(
    repo,
    "src/greet.test.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport * as fs from "node:fs";\n` +
      `test("greet is finished", () => assert.ok(fs.readFileSync("src/greet.mjs", "utf8").includes("finished"), "src/greet.mjs must say finished"));\n`,
  );
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "a standing test"]);
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-34" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  const replies: string[] = [];
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      // The whole suite is green here (the gate); what the coder sees is the scoped run.
      suiteCommand: ["node", "-e", "process.exit(0)"],
      runOne: "node --test <file>",
      affected: async (p) => (p === "src/greet.mjs" ? "[imports] src/greet.test.mjs:L3" : ""),
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w) => {
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        const first = await w.verifyTool!();
        replies.push(first);
        // The coder reads the suite's word and fixes its own tree.
        if (/YOURS/.test(first) && /greet is finished/.test(first))
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n// finished\n`);
        replies.push(await w.verifyTool!());
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.match(replies[0], /THE REPOSITORY'S OWN CHECKS/, "the standing tests are in the coder's verify reply");
  assert.match(replies[0], /YOURS[\s\S]*greet is finished[\s\S]*src\/greet\.mjs must say finished/, "named, with the runner's words, as the coder's own");
  assert.match(replies[1], /Green on your tree/, "and green once fixed");
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "delivered — the gate found the suite green");
  assert.ok(![...state.units.values()].some((u) => u.id.startsWith("gate#")), "no finisher was needed");
  const unitLog = state.stepLogs.get("SL-1#eu-0") ?? [];
  assert.ok(unitLog.some((l) => /running 1 standing test file\(s\) that import this slice's files: src\/greet\.test\.mjs/.test(l)), "the scope is said: one file, named");
});

test("a red suite at the gate goes to a finisher in the run, which brings the tree under; the delivery is opened, not withheld", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-35" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let finisherBrief = "";
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      // Green in a slice's runner (the runner tree is under oracle-runners),
      // red on the delivered tree until greet says finished — a check only
      // the gate sees red.
      suiteCommand: [
        "node",
        "-e",
        "if(process.cwd().includes('oracle-runners')){console.log('ok 1 - x\\n# fail 0');process.exit(0)};" + SUITE_WANTS_FINISHED[2],
      ],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w, brief) => {
        if (/FINISHER/.test(brief)) {
          finisherBrief = brief;
          assert.ok(w.footprint.includes("src/greet.mjs"), "the finisher may edit what the delivery touched");
          const before = await w.verifyTool!();
          assert.match(before, /greet is finished/);
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n// finished\n`);
          const after = await w.verifyTool!();
          assert.match(after, /Green on your tree/);
          return { ok: true, finalText: "UNDELIVERED: none" };
        }
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    },
    space,
    cut,
    slices,
  );
  assert.match(finisherBrief, /THE RED TESTS[\s\S]*greet is finished[\s\S]*src\/greet\.mjs must say finished/, "the finisher is told the red tests in the runner's words");
  assert.match(finisherBrief, /Never weaken, skip, delete or restamp/, "and the rules");
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "the delivery is opened");
  assert.ok(outcome.delivery!.proofs.some((p) => p.kind === "suite" && p.verdict === "green"));
  const finisher = state.units.get("gate#suite-1");
  assert.equal(finisher?.state, "done", "the finisher is a unit on the record, done");
  assert.equal(finisher?.role, "maintain");
  const runLog = state.stepLogs.get("gate#suite-1") ?? [];
  assert.ok(runLog.some((l) => /finisher brings it under/.test(l)) && runLog.some((l) => /under the repository's suite/.test(l)));
});

test("the closer is the floor: a unit no other actor could finish is handed to it with full sight, and what it fixes lands green", async () => {
  const repo = tmpRepo();
  const { space, ids } = spaceWithOneChange();
  const cut = { id: "cut-1", changeIds: ids, tepId: "TEP-t-81" };
  const slices = tepSlices({ space, cut, spaceName: "greet space" });
  const state = new RunState(() => {});
  let closerBrief = "";
  let coderRounds = 0;
  const outcome = await dispatchTep(
    {
      repoRoot: repo,
      model: "sonnet",
      suiteCommand: ["node", "-e", "process.exit(0)"],
      state,
      supervisorRound: async () => null,
      rehome: async () => ({ anchors: [], notes: [] }),
      spaceName: "greet space",
      worker: async (w: { role: string; worktree: string; footprint: string[]; verifyTool?: () => Promise<string> }, brief: string) => {
        if (/You are the CLOSER/.test(brief)) {
          closerBrief = brief;
          // It sees the checks, and can therefore finish what the blind coder could not.
          writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "hello"; }\n`);
          return { ok: true, finalText: "RULING: none needed\nUNDELIVERED: none" };
        }
        if (w.role === "test") {
          writeInto(w.worktree, w.footprint[0], GREEN_PROBE);
          return { ok: true, finalText: "done" };
        }
        // The coder never gets it right: it writes something that cannot pass.
        coderRounds++;
        writeInto(w.worktree, "src/greet.mjs", `export function greet() { return "not hello"; }\n`);
        return { ok: true, finalText: "done" };
      },
    } as never,
    space,
    cut,
    slices,
  );
  assert.ok(closerBrief, "the closer was called once the cheap rungs were spent");
  assert.match(closerBrief, /THE CHECKS, IN FULL[\s\S]*greet/, "with the checks themselves");
  assert.match(closerBrief, /WHAT THE RUN ALREADY TRIED/, "and what was already tried");
  assert.ok(coderRounds <= 2, `the coder stopped after its small budget (${coderRounds} attempts)`);
  assert.equal(state.units.get("SL-1#eu-0")?.state, "done", "the unit is done — the closer finished it");
  assert.ok(outcome.delivery && !outcome.delivery.withheld, "and the run delivers");
});
