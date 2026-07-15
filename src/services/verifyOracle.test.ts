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
  sharedFailureSignature,
  formatVerifyReply,
  createVerifyOracle,
  type VerifyOracleDeps,
  type VerifyResult,
  redactTestSideDiagnostics,
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

test("formatVerifyReply: a boundary build fault points at contract conformance without asserting fault, and leaks no probe source", () => {
  const msg = formatVerifyReply({
    kind: "build-failed",
    testFault: true,
    errorFiles: ["src/acceptance/SP-17_1_AC-1.test.ts"],
    output: "const SECRET_PROBE_SOURCE = …",
  });
  assert.match(msg, /boundary between your implementation and this slice's checks/i);
  assert.match(msg, /SIGNATURE BY SIGNATURE/);
  assert.doesNotMatch(msg, /not your code|yours to fix/i, "never asserts whose fault it is — location is not fault");
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
  contentTag?: string;
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
    readFile: async (root, rel) => `${root}:${rel}:${over.contentTag ?? "v1"}`,
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

// ── confirmGreen (mandatory-verify + gate confirmation) ──────────────────────

test("confirmGreen: a green round then confirm with UNCHANGED state confirms WITHOUT re-running", async () => {
  const w = makeWorld(); // all probes pass → green
  const oracle = createVerifyOracle(w.deps);
  const first = await oracle.verify();
  assert.equal(first.kind, "results");
  const execsAfterVerify = w.execs.length;
  const g = await oracle.confirmGreen();
  assert.equal(g.green, true);
  assert.equal(w.execs.length, execsAfterVerify, "confirm-skip: no commands re-run when state is identical");
});

test("confirmGreen: a green round then confirm with DRIFTED state re-runs", async () => {
  const w = makeWorld();
  const oracle = createVerifyOracle(w.deps);
  await oracle.verify();
  const execsBefore = w.execs.length;
  // Drift the verified content (the readFile tag changes) → the state hash differs → re-run.
  w.deps.readFile = async (root, rel) => `${root}:${rel}:v2-drifted`;
  const g = await oracle.confirmGreen();
  assert.ok(w.execs.length > execsBefore, "drift forces a fresh round");
  assert.equal(g.green, true, "the fresh round is still green");
});

test("confirmGreen: with NO prior round it runs a fresh round and reports its greenness", async () => {
  const w = makeWorld({ probeCodes: { "node --test out-test/acceptance/SP-17_1_AC-2.test.js": 1 } });
  const oracle = createVerifyOracle(w.deps);
  const g = await oracle.confirmGreen();
  assert.ok(w.execs.length > 0, "a round ran");
  assert.equal(g.green, false, "a red probe → not green");
});

test("confirmGreen: a red round never confirms green", async () => {
  const w = makeWorld({ prepareCode: 2, prepareOut: "src/services/x.ts(1,1): error TS1005" });
  const oracle = createVerifyOracle(w.deps);
  await oracle.verify(); // build-failed
  const g = await oracle.confirmGreen();
  assert.equal(g.green, false);
});

// ── Evidence widening, root-cause collapse, stall breaker (2026-07-14) ────────
//
// WHY: seen live on TEP-21/SP-2 — every host probe died at the same boundary
// (a stale singleton socket) and the runner swallowed the error, so the coder
// got "0/6, nothing attached" for round after round and started probing the
// fences. The oracle must (a) disclose every safe detail from round 1,
// (b) name one boundary failure ONCE instead of n masked copies, and
// (c) stop an information-free loop instead of letting it burn the budget.

test("probeEvidence names EVERY failing test and carries all failing blocks (TAP)", () => {
  const out = [
    "not ok 1 - the panel must be shown immediately on the first call",
    "  ---",
    "  error: boom-one",
    "not ok 2 - the session file must exist after flush",
    "  ---",
    "  error: boom-two",
  ].join("\n");
  const ev = probeEvidence("run", 1, out);
  assert.match(ev, /failing tests:/);
  assert.match(ev, /panel must be shown immediately/);
  assert.match(ev, /session file must exist after flush/);
  assert.match(ev, /boom-one/);
  assert.match(ev, /boom-two/, "the SECOND failing block is included, not only the first");
});

test("probeEvidence surfaces assertion blocks from non-TAP (extension-host) output", () => {
  const out = [
    "Loading development extension…",
    "AssertionError [ERR_ASSERTION]: a tab labelled 'Thinkube Scratchpad' must be open",
    "    at Object.run (/x/SP-21_2_AC-1.host.js:98:12)",
    "Exit code:   1",
  ].join("\n");
  const ev = probeEvidence("run", 1, out);
  assert.match(ev, /a tab labelled 'Thinkube Scratchpad' must be open/);
});

test("sharedFailureSignature: identical failures collapse, differing ones do not, single failure never does", () => {
  const mk = (ac: number, pass: boolean, body: string) => ({
    ac,
    pass,
    evidence: `$ run${ac} → exit ${pass ? 0 : 1}\n${body}`,
  });
  assert.ok(
    sharedFailureSignature([mk(1, false, "same wall"), mk(2, false, "same wall"), mk(3, true, "")]),
  );
  assert.equal(
    sharedFailureSignature([mk(1, false, "wall A"), mk(2, false, "wall B")]),
    undefined,
  );
  assert.equal(sharedFailureSignature([mk(1, false, "same wall")]), undefined);
});

test("formatVerifyReply: a rootCause is named ONCE, first, as one boundary failure", () => {
  const msg = formatVerifyReply({
    kind: "results",
    rootCause: "Error: listen EADDRINUSE — singleton lock",
    results: [
      { ac: 1, pass: false, evidence: "$ r1 → exit 1\nErr" },
      { ac: 2, pass: false, evidence: "$ r2 → exit 1\nErr" },
    ],
  });
  assert.match(msg, /ALL 2 FAILING PROBES FAIL IDENTICALLY/);
  assert.match(msg, /one boundary failure, not 2 independent bugs/);
  assert.match(msg, /EADDRINUSE/);
});

test("oracle: three identical failing rounds trip the stall breaker; the fourth call runs nothing and says stop", async () => {
  const w = makeWorld({
    probeCodes: {
      "node --test out-test/acceptance/SP-17_1_AC-1.test.js": 1,
      "node --test out-test/acceptance/SP-17_1_AC-2.test.js": 1,
    },
  });
  const oracle = createVerifyOracle(w.deps);
  await oracle.verify();
  await oracle.verify();
  await oracle.verify();
  const execsBefore = w.execs.length;
  const r = await oracle.verify();
  assert.equal(r.kind, "stalled", "identical outcome x3 → stalled");
  assert.equal(w.execs.length, execsBefore, "a stalled round runs no commands");
  assert.match(formatVerifyReply(r), /STALLED: 3 consecutive verify rounds/);
});

test("oracle: an outcome CHANGE resets the stall counter", async () => {
  let failBoth = true;
  const w = makeWorld();
  const origExec = w.deps.exec;
  w.deps.exec = async (cmd, cwd) => {
    if (cmd.startsWith("npx tsc")) return origExec(cmd, cwd);
    w.execs.push({ cmd, cwd });
    const fails = failBoth || cmd.includes("AC-1");
    return { code: fails ? 1 : 0, output: fails ? "not ok 1 - failed" : "ok" };
  };
  const oracle = createVerifyOracle(w.deps);
  await oracle.verify(); // fail/fail (1)
  await oracle.verify(); // fail/fail (2)
  failBoth = false;      // the coder fixed AC-2 — outcome changes
  await oracle.verify(); // fail/pass — resets the counter
  const r = await oracle.verify(); // fail/pass again (count 2) — still runs
  assert.equal(r.kind, "results", "progress resets the stall counter — no premature stop");
});

// ── redactTestSideDiagnostics (2026-07-15): identifier truth, no probe source ──

test("redactTestSideDiagnostics: safe codes verbatim, unsafe reduced, non-test files dropped", () => {
  const out = [
    `src/acceptance/SP-21_3_AC-10.test.ts(12,5): error TS2305: Module '"../scratchpad/model"' has no exported member 'supersededBy'.`,
    `src/acceptance/SP-21_3_AC-10.test.ts(30,9): error TS2345: Argument of type '{ secret: "leak" }' is not assignable to parameter.`,
    `src/scratchpad/model.ts(4,1): error TS2304: Cannot find name 'oops'.`,
    "some non-diagnostic line",
  ].join("\n");
  const r = redactTestSideDiagnostics(out, ["src/acceptance/SP-21_3_AC-10.test.ts"]);
  assert.match(r, /TS2305: Module .* has no exported member 'supersededBy'/);
  assert.match(r, /TS2345 \(details withheld\)/);
  assert.ok(!r.includes("leak"), "unsafe message text must not leak");
  assert.ok(!r.includes("model.ts(4"), "non-test-side lines are dropped");
});
