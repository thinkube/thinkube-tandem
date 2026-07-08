/**
 * verifyOracle (tests-first repair window): the coder's black-box feedback channel.
 * Pure core (porcelain parsing, prepare-failure classification, reply formatting) +
 * the shell with every effect faked — no git, no fs, no processes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parsePorcelain,
  classifyPrepareFailure,
  probeEvidence,
  formatVerifyReply,
  createVerifyOracle,
  type VerifyOracleDeps,
  type VerifyResult,
} from "./verifyOracle";

// ── parsePorcelain ───────────────────────────────────────────────────────────

test("parsePorcelain: modified, untracked, deleted and renamed entries become the overlay plan", () => {
  const plan = parsePorcelain(
    [
      " M src/a.ts",
      "?? src/new.ts",
      " D src/gone.ts",
      'R  "old name.ts" -> "new name.ts"',
      "",
    ].join("\n"),
  );
  const byPath = new Map(plan.map((e) => [e.path, e.deleted]));
  assert.equal(byPath.get("src/a.ts"), false);
  assert.equal(byPath.get("src/new.ts"), false);
  assert.equal(byPath.get("src/gone.ts"), true);
  assert.equal(byPath.get("old name.ts"), true, "rename source is deleted");
  assert.equal(byPath.get("new name.ts"), false, "rename target is copied");
});

test("parsePorcelain: a delete followed by a re-add of the same path resolves to a copy", () => {
  const plan = parsePorcelain([" D src/x.ts", "?? src/x.ts"].join("\n"));
  assert.deepEqual(plan, [{ path: "src/x.ts", deleted: false }]);
});

// ── classifyPrepareFailure ───────────────────────────────────────────────────

const PROBES = [
  "src/acceptance/SP-17_1_AC-1.test.ts",
  "src/acceptance/SP-17_1_AC-2.test.ts",
];

test("classifyPrepareFailure: errors ONLY in probe files → test-side fault", () => {
  const out = [
    "src/acceptance/SP-17_1_AC-1.test.ts(12,5): error TS2307: Cannot find module './nope'.",
    "src/acceptance/SP-17_1_AC-2.test.ts(3,1): error TS2552: Cannot find name 'resolveWorkerModle'.",
  ].join("\n");
  const c = classifyPrepareFailure(out, PROBES);
  assert.equal(c.testFault, true);
  assert.deepEqual(c.errorFiles, PROBES);
});

test("classifyPrepareFailure: a mixed failure (code + probe) is NOT a test fault", () => {
  const out = [
    "src/services/workerModel.ts(4,10): error TS2322: Type 'number' is not assignable to type 'string'.",
    "src/acceptance/SP-17_1_AC-1.test.ts(12,5): error TS2307: Cannot find module.",
  ].join("\n");
  const c = classifyPrepareFailure(out, PROBES);
  assert.equal(c.testFault, false);
  assert.ok(c.errorFiles.includes("src/services/workerModel.ts"));
});

test("classifyPrepareFailure: no locatable file → not a test fault (fail toward the build)", () => {
  const c = classifyPrepareFailure("Error: Cannot find module 'typescript'", PROBES);
  assert.equal(c.testFault, false);
  assert.deepEqual(c.errorFiles, []);
});

// ── probeEvidence / formatVerifyReply ────────────────────────────────────────

test("probeEvidence: a pass is the exit line only; a failure carries the first failing assertion block", () => {
  assert.equal(probeEvidence("node --test x.js", 0, "ok 1 - fine"), "$ node --test x.js → exit 0");
  const failed = probeEvidence(
    "node --test x.js",
    1,
    ["# start", "not ok 1 - resolves sonnet", "  ---", "  error: expected 'sonnet' got undefined", "  ..."].join("\n"),
  );
  assert.match(failed, /exit 1/);
  assert.match(failed, /not ok 1 - resolves sonnet/);
  assert.match(failed, /expected 'sonnet' got undefined/);
});

test("formatVerifyReply: a test-side build fault tells the coder it is not theirs and leaks no probe source", () => {
  const msg = formatVerifyReply({
    kind: "build-failed",
    testFault: true,
    errorFiles: ["src/acceptance/SP-17_1_AC-1.test.ts"],
    output: "const SECRET_PROBE_SOURCE = …",
  });
  assert.match(msg, /not your code/i);
  assert.match(msg, /NOT yours to fix/);
  assert.match(msg, /SP-17_1_AC-1\.test\.ts/);
  assert.doesNotMatch(msg, /SECRET_PROBE_SOURCE/, "probe text never reaches the coder");
});

test("formatVerifyReply: results render a pass count and per-AC verdicts; exhausted tells the coder to stop", () => {
  const msg = formatVerifyReply({
    kind: "results",
    results: [
      { ac: 1, pass: true, evidence: "$ run1 → exit 0" },
      { ac: 2, pass: false, evidence: "$ run2 → exit 1\nnot ok 1 - x" },
    ],
  });
  assert.match(msg, /PROBES: 1\/2 pass/);
  assert.match(msg, /AC-1: PASS/);
  assert.match(msg, /AC-2: FAIL/);
  assert.match(formatVerifyReply({ kind: "exhausted", invocations: 20 }), /VERIFY LIMIT REACHED/);
});

// ── createVerifyOracle (shell, all effects faked) ────────────────────────────

interface FakeWorld {
  deps: VerifyOracleDeps;
  copies: string[];
  removals: string[];
  resets: number;
  execs: { cmd: string; cwd: string }[];
}

function makeWorld(over: {
  porcelain?: string;
  prepareCode?: number;
  prepareOut?: string;
  probeCodes?: Record<string, number>;
  maxInvocations?: number;
} = {}): FakeWorld {
  const w: FakeWorld = { copies: [], removals: [], resets: 0, execs: [], deps: undefined! };
  w.deps = {
    codeWorktree: "/wt/code",
    testerWorktree: "/wt/test",
    runnerDir: "/wt/runner",
    probeFiles: PROBES,
    prepare: "npx tsc -p tsconfig.test.json",
    verifications: [
      { ac: 1, run: "node --test out-test/acceptance/SP-17_1_AC-1.test.js", env: "local" },
      { ac: 2, run: "node --test out-test/acceptance/SP-17_1_AC-2.test.js", env: "local" },
      { ac: 3, run: "", env: "assessment" }, // assessment: skipped by the oracle
    ],
    exec: async (cmd, cwd) => {
      w.execs.push({ cmd, cwd });
      if (cmd.startsWith("npx tsc"))
        return { code: over.prepareCode ?? 0, output: over.prepareOut ?? "" };
      return { code: over.probeCodes?.[cmd] ?? 0, output: over.probeCodes?.[cmd] ? "not ok 1 - failed" : "ok" };
    },
    porcelain: async () => over.porcelain ?? " M src/services/workerModel.ts\n D src/services/old.ts",
    resetRunner: async () => void w.resets++,
    copyIn: async (fromRoot, rel) => void w.copies.push(`${fromRoot}:${rel}`),
    removeIn: async (rel) => void w.removals.push(rel),
    maxInvocations: over.maxInvocations,
  };
  return w;
}

test("oracle: a round resets the runner, overlays the coder delta + probes, builds, runs probes, returns per-AC results", async () => {
  const w = makeWorld({ probeCodes: { "node --test out-test/acceptance/SP-17_1_AC-2.test.js": 1 } });
  const oracle = createVerifyOracle(w.deps);
  const r = await oracle.verify();
  assert.equal(w.resets, 1);
  assert.ok(w.copies.includes("/wt/code:src/services/workerModel.ts"), "coder delta copied");
  assert.deepEqual(w.removals, ["src/services/old.ts"], "coder deletion mirrored");
  assert.ok(w.copies.includes("/wt/test:src/acceptance/SP-17_1_AC-1.test.ts"), "probes copied from the tester tree");
  assert.equal(r.kind, "results");
  const res = (r as Extract<VerifyResult, { kind: "results" }>).results;
  assert.deepEqual(res.map((x) => [x.ac, x.pass]), [[1, true], [2, false]]);
  // every command ran in the ISOLATED runner, never in the coder's tree
  assert.ok(w.execs.every((e) => e.cwd === "/wt/runner"));
});

test("oracle: a prepare failure located only in probe files returns build-failed with testFault", async () => {
  const w = makeWorld({
    prepareCode: 2,
    prepareOut: "src/acceptance/SP-17_1_AC-1.test.ts(1,1): error TS2307: Cannot find module 'x'.",
  });
  const r = await createVerifyOracle(w.deps).verify();
  assert.equal(r.kind, "build-failed");
  const b = r as Extract<VerifyResult, { kind: "build-failed" }>;
  assert.equal(b.testFault, true);
  // probes never ran
  assert.ok(!w.execs.some((e) => e.cmd.startsWith("node --test")));
});

test("oracle: concurrent verify calls are serialized (no interleaved rounds)", async () => {
  const w = makeWorld();
  let inFlight = 0;
  let maxInFlight = 0;
  const baseExec = w.deps.exec;
  w.deps.exec = async (cmd, cwd) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return baseExec(cmd, cwd);
  };
  const oracle = createVerifyOracle(w.deps);
  await Promise.all([oracle.verify(), oracle.verify(), oracle.verify()]);
  assert.equal(maxInFlight, 1, "rounds never overlap — one runner, one round at a time");
  assert.equal(oracle.invocations(), 3);
});

test("oracle: the invocation cap yields `exhausted` and runs nothing further", async () => {
  const w = makeWorld({ maxInvocations: 2 });
  const oracle = createVerifyOracle(w.deps);
  await oracle.verify();
  await oracle.verify();
  const execsBefore = w.execs.length;
  const r = await oracle.verify();
  assert.equal(r.kind, "exhausted");
  assert.equal(w.execs.length, execsBefore, "an exhausted round runs no commands");
});
