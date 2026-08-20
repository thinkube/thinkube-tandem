import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseSuite,
  sourceOf,
  suiteAcceptable,
  suiteFootprint,
  suiteOwner,
  suiteVerdictOf,
  suiteWaitsForTree,
  withSuite,
} from "./suite";
import type { SuiteFailure } from "./suite";
import { verdictOf } from "./assess";
import { isDeferralVocabulary } from "./plan";
import type { VerifyOracle, VerifyResult } from "../engine/verifyOracle";

const TAP = `
# Subtest: the phase gates the controls
ok 1 - the phase gates the controls
# Subtest: real tree: ENGINE-WIRING.md is complete against the current scan
not ok 2 - real tree: ENGINE-WIRING.md is complete against the current scan
  ---
  duration_ms: 12.5
  location: '/tmp/x/out-test/engine/engineWiring.test.js:120:5'
  failureType: 'testCodeFailure'
  error: |-
    every unreached engine module has a ledger entry
    + actual - expected
    + [ 'src/engine/acSignature.ts', 'src/engine/openingGate.ts' ]
    - []
  code: 'ERR_ASSERTION'
  ...
# Subtest: knip
not ok 3 - knip: every file, export and dependency is reachable
  ---
  location: '/tmp/x/out-test/hygiene.test.js:14:1'
  error: |-
    orphaned code:
    Unused exports (1)
    handleInbound  function  src/surfaces/panel.ts:335:23
  ...
# tests 3
# pass 1
# fail 2
`;

test("the suite's TAP output is read into named, located failures with the runner's words", () => {
  const v = parseSuite(TAP);
  assert.equal(v.green, false);
  assert.deepEqual(
    v.failures.map((f) => [f.name, f.file]),
    [
      ["real tree: ENGINE-WIRING.md is complete against the current scan", "src/engine/engineWiring.test.ts"],
      ["knip: every file, export and dependency is reachable", "src/hygiene.test.ts"],
    ],
  );
  assert.match(v.failures[0].detail, /every unreached engine module has a ledger entry/);
  assert.match(v.failures[1].detail, /handleInbound/);
  assert.match(v.summary, /# fail 2/);
  assert.equal(parseSuite("ok 1 - fine\n# tests 1\n# pass 1\n# fail 0\n").green, true);
  assert.equal(sourceOf("/a/b/out/surfaces/panel.js"), "src/surfaces/panel.ts");
  // A red exit that names nothing is still red, in the runner's words.
  const silent = suiteVerdictOf(1, "npm ERR! something broke\n");
  assert.equal(silent.green, false);
  assert.match(silent.failures[0].name, /exited with code 1/);
  assert.match(silent.failures[0].detail, /something broke/);
  assert.equal(suiteVerdictOf(0, "ok 1 - x\n# fail 0\n").green, true);
});

test("every red suite test has an owner: the maintainer's test home, the tree that is not ready, or the coder", () => {
  const home: SuiteFailure = { name: "old rule", file: "src/gates/gates.test.ts", detail: "expected true" };
  const tree: SuiteFailure = { name: "missing", detail: "Cannot find module '../out/surfaces/spaceTabs.js'" };
  const mine: SuiteFailure = { name: "size", file: "src/hygiene.test.ts", detail: "src/extension.ts: 656 lines" };
  const ctx = { maintainHomes: ["src/gates/gates.test.ts"], pendingPlanned: ["src/surfaces/spaceTabs.ts"] };
  assert.equal(suiteOwner(home, ctx), "maintainer");
  assert.equal(suiteOwner(tree, ctx), "tree");
  assert.equal(suiteOwner(mine, ctx), "code");
});

function fakeOracle(results: VerifyResult, stateHash = "h1"): VerifyOracle {
  return {
    verify: async () => results,
    confirmGreen: async () => ({ green: results.kind === "results" && results.results.every((r) => r.pass), result: results }),
    invocations: () => 1,
    last: () => ({ green: true, stateHash, result: results }),
  };
}

test("the oracle with the suite behind it: green checks run the suite once per state; a coder is green only when no red test is its own", async () => {
  const green: VerifyResult = { kind: "results", results: [{ ac: 1, pass: true, evidence: "" }] };
  let runs = 0;
  let output = TAP;
  const oracle = withSuite(fakeOracle(green), {
    run: async () => (runs++, suiteVerdictOf(1, output)),
    maintainHomes: () => [],
    pendingPlanned: () => [],
  });
  const r = await oracle.verify();
  assert.equal(runs, 1, "the suite ran when the checks were green");
  assert.ok(r.suite && !r.suite.verdict.green);
  assert.match(r.suite!.stanza, /YOURS — your tree makes these standing checks fail/);
  assert.match(r.suite!.stanza, /ENGINE-WIRING/);
  const c = await oracle.confirmGreen();
  assert.equal(runs, 1, "the same verified state does not run the suite twice");
  assert.equal(c.green, false, "green checks and a red suite are not green");

  // Only a maintainer's test home is red: green for the coder, the maintainer's to bring under.
  const only = withSuite(fakeOracle(green, "h2"), {
    run: async () => suiteVerdictOf(1, TAP.replace("out-test/engine/engineWiring.test.js", "out-test/gates/gates.test.js").split("# Subtest: knip")[0] + "# fail 1\n"),
    maintainHomes: () => ["src/gates/gates.test.ts"],
    pendingPlanned: () => [],
  });
  const c2 = await only.confirmGreen();
  assert.equal(c2.green, true);
  assert.ok(suiteAcceptable(c2.result.suite!));
  assert.match(c2.result.suite!.stanza, /NOT YOURS/);

  // Red checks: the suite is not run at all.
  const red: VerifyResult = { kind: "results", results: [{ ac: 1, pass: false, evidence: "boom" }] };
  let ran = 0;
  const notYet = withSuite(fakeOracle(red, "h3"), { run: async () => (ran++, suiteVerdictOf(0, "")), maintainHomes: () => [], pendingPlanned: () => [] });
  await notYet.verify();
  assert.equal(ran, 0, "the suite waits for the slice's own checks");

  // The tree's failures alone: wait, do not rework.
  const treeOnly = withSuite(fakeOracle(green, "h4"), {
    run: async () => ({ green: false, summary: "", failures: [{ name: "x", detail: "Cannot find module 'src/surfaces/spaceTabs.ts'" }] }),
    maintainHomes: () => [],
    pendingPlanned: () => ["src/surfaces/spaceTabs.ts"],
  });
  const c4 = await treeOnly.confirmGreen();
  assert.equal(c4.green, false);
  assert.ok(suiteWaitsForTree(c4.result.suite!));
});

test("the finisher's footprint: the red tests' files, the production they are named after, and the files the runner names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-suite-"));
  for (const f of ["src/surfaces/panel.test.ts", "src/surfaces/panel.ts", "src/extension.ts", "ENGINE-WIRING.md"]) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), "");
  }
  const fp = suiteFootprint(
    [
      { name: "a", file: "src/surfaces/panel.test.ts", detail: "expected" },
      { name: "b", file: "src/hygiene.test.ts", detail: "src/extension.ts: 656 lines; src/nowhere.ts" },
    ],
    root,
  );
  assert.deepEqual(fp.sort(), ["src/extension.ts", "src/surfaces/panel.test.ts", "src/surfaces/panel.ts"]);
});

test("the reviewer's verdict is its last GREEN/RED line — narration before it is read, no verdict is red", () => {
  assert.equal(verdictOf("Let me check.\nOnly one call site.\n\nGREEN — the sole dispatch call site threads the TEP once."), "GREEN");
  assert.equal(verdictOf("RED — the built site still carries the old sentence"), "RED");
  assert.equal(verdictOf("I read panel.ts and found it.\n**GREEN** — fine"), "GREEN");
  assert.equal(verdictOf("I ran out of turns reading."), undefined);
  assert.equal(verdictOf(null), undefined);
});

test("the honesty scan does not confess the code's own vocabulary", () => {
  assert.equal(isDeferralVocabulary("  undelivered?: string[];"), true);
  assert.equal(isDeferralVocabulary(" * UNDELIVERED, containment, red proofs — never as silence."), true);
  assert.equal(isDeferralVocabulary("// UNDELIVERED: the docs page is not written"), false);
  assert.equal(isDeferralVocabulary("// TODO: wire the panel"), false);
});

test("a suite command with spaces in an argument survives the shell", async () => {
  const { shellLine } = await import("./execs");
  assert.equal(shellLine(["npm", "test"]), "npm test");
  assert.equal(shellLine(["node", "-e", "process.exit(1 ? 1 : 0)"]), "node -e 'process.exit(1 ? 1 : 0)'");
});

test("a suite that cannot run in the runner is the environment's, not the coder's — unless what it says names the coder's files", async () => {
  const ctx = { maintainHomes: [], pendingPlanned: [], footprint: ["src/greet.ts"] };
  const noRun: SuiteFailure = { name: "the suite exited with code 1", detail: "sh: vite: not found\nnpm ERR! Lifecycle script failed" };
  const mine: SuiteFailure = { name: "the suite exited with code 2", detail: "src/greet.ts(3,1): error TS2322: type mismatch" };
  assert.equal(suiteOwner(noRun, ctx), "environment");
  assert.equal(suiteOwner(mine, ctx), "code");
  const green: VerifyResult = { kind: "results", results: [{ ac: 1, pass: true, evidence: "" }] };
  const seen: string[] = [];
  const o = withSuite(fakeOracle(green, "h9"), {
    run: async () => suiteVerdictOf(1, "sh: vite: not found\n"),
    maintainHomes: () => [],
    pendingPlanned: () => [],
    footprint: () => ["src/greet.ts"],
    onEnvironment: (d) => seen.push(d),
  });
  const c = await o.confirmGreen();
  assert.equal(c.green, true, "the coder is not held for the runner's failure");
  assert.match(c.result.suite!.stanza, /ENVIRONMENT \(not your code\)/);
  assert.equal(seen.length, 1, "and it is on the record");
});

test("the scope of a slice's standing tests: what imports its files, through production, plus what bit at an earlier gate — only files that exist", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-scope-"));
  for (const f of ["src/a.ts", "src/b.ts", "src/a.test.ts", "src/b.test.ts", "src/hygiene.test.ts", "probes/p.test.mjs"]) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), "");
  }
  const graph: Record<string, string[]> = {
    "src/a.ts": ["src/a.test.ts", "src/b.ts", "probes/p.test.mjs"],
    "src/b.ts": ["src/b.test.ts"],
  };
  const { scopedTests } = await import("./suite");
  const files = await scopedTests({ root, footprint: ["src/a.ts"], importersOf: async (p) => graph[p] ?? [], always: ["src/hygiene.test.ts", "src/gone.test.ts"] });
  assert.deepEqual(files.sort(), ["src/a.test.ts", "src/b.test.ts", "src/hygiene.test.ts"], "direct, through b, and the remembered gate red; never a probe, never a missing file");
});

test("the scoped run: one file at a time with the proven command; red files named even when the runner's words do not name them", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-scope-"));
  for (const f of ["src/a.ts", "src/a.test.ts", "src/c.test.ts"]) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), "");
  }
  const { runScopedSuite } = await import("./suite");
  const ran: string[] = [];
  const v = await runScopedSuite({
    runOne: "run-it <file>",
    root,
    exec: async (cmd) => {
      ran.push(cmd);
      return cmd.includes("c.test") ? { code: 1, output: "boom\n" } : { code: 0, output: "ok 1 - fine\n# fail 0\n" };
    },
    footprint: ["src/a.ts"],
    importersOf: async () => ["src/a.test.ts", "src/c.test.ts"],
  });
  assert.deepEqual(ran, ["run-it src/a.test.ts", "run-it src/c.test.ts"]);
  assert.equal(v.green, false);
  assert.equal(v.failures[0].file, "src/c.test.ts");
  assert.match(v.failures[0].name, /src\/c\.test\.ts: the test exited with code 1/);
  assert.match(v.summary, /2 standing test file\(s\): 1 green, 1 red/);
  const none = await runScopedSuite({ runOne: "run-it <file>", root, exec: async () => ({ code: 0, output: "" }), footprint: ["src/a.ts"], importersOf: async () => [] });
  assert.equal(none.green, true);
});

test("a probe that loads a source file the runner cannot execute is the check's failure — the repair loop owns it", async () => {
  const { ownerOf } = await import("./owner");
  assert.equal(
    ownerOf('failing tests:\n  - pin\nTypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for /x/src/run/state.ts'),
    "check",
  );
  assert.equal(ownerOf("expected 'a' to equal 'b'"), "code");
});

test("every command the run executes is bounded and named: a hung command becomes 'timed out' with its own name", async () => {
  const { makeExec } = await import("./oracle");
  const quick = makeExec(300);
  const r = await quick("sleep", ["30"], "/tmp");
  assert.equal(r.code, 124);
  assert.match(r.out, /timed out after 0s: sleep 30/);
  const fine = await quick("node", ["-e", "console.log('ok')"], "/tmp");
  assert.equal(fine.code, 0);
  assert.match(fine.out, /ok/);
});

test("the heartbeat: a silent run declares itself dead at its last named step; a beating or finished run is left alone", async () => {
  const { silentVerdict } = await import("./state");
  const base = { running: true, lastBeatMs: 0, nowMs: 26 * 60 * 1000, limitMs: 25 * 60 * 1000 };
  assert.match(
    silentVerdict({ ...base, busyUnits: [{ id: "SL-3#eu-0", text: "waiting on verify — round 2" }] })!,
    /went silent for 26 minutes at: SL-3#eu-0 \(waiting on verify — round 2\)/,
  );
  assert.match(silentVerdict({ ...base, lastLine: "building the untouched tree" })!, /at: building the untouched tree/);
  assert.equal(silentVerdict({ ...base, nowMs: 10 * 60 * 1000 }), undefined, "a beating run is left alone");
  assert.equal(silentVerdict({ ...base, running: false }), undefined, "a finished run is left alone");
});

test("the compiler's words reach the actor verbatim, verdict first; an empty build failure says so", async () => {
  const { formatBuild } = await import("./execs");
  assert.equal(formatBuild({ code: 0, output: "" }), "BUILD GREEN");
  assert.match(formatBuild({ code: 2, output: "src/a.ts(3,1): error TS2322: nope" }), /^BUILD RED \(exit 2\)\nsrc\/a\.ts\(3,1\)/);
  assert.match(formatBuild({ code: 124, output: "" }), /produced no output — it may have timed out/);
  const { formatVerifyReply } = await import("../engine/verifyOracle");
  assert.match(
    formatVerifyReply({ kind: "build-failed", testFault: false, errorFiles: [], output: "  " }),
    /produced no output.*run the `build` tool/,
  );
});

test("a missing probe FILE is the check's failure — the repair regenerates it from the criterion; a missing tool stays the environment's", async () => {
  const { ownerOf } = await import("./owner");
  assert.equal(ownerOf("Error: Cannot find module '/x/runner/probes/space__SL-5_AC-6.test.mjs'"), "check");
  assert.equal(ownerOf("Could not find '/x/runner/probes/space__SL-5_AC-9.test.mjs'"), "check");
  assert.equal(ownerOf("ENOENT: no such file or directory, open 'probes/space__SL-5_AC-6.test.mjs'"), "check");
  assert.equal(ownerOf("sh: tsc: command not found"), "environment");
});

test("evidence a coder cannot act on is recognised as such", async () => {
  const { uninformative } = await import("./diagnose");
  assert.equal(
    uninformative("AssertionError [ERR_ASSERTION]: the bar reports the run\n  expected:\n  actual: ''\n  operator: 'match'"),
    true,
    "an assertion whose expected and actual show nothing",
  );
  assert.equal(uninformative("  "), true);
  assert.equal(uninformative("$ node --test probes/x.test.mjs → exit 1"), true, "a command line is not evidence");
  assert.equal(
    uninformative("AssertionError: expected 'hello' to equal 'bye'\n  expected: 'bye'\n  actual: 'hello'"),
    false,
    "values the coder can act on",
  );
  assert.equal(uninformative("Cannot find module '../out/greet.js'"), false, "a named cause is evidence");
});

test("the diagnoser RUNS the failing check, gives the judge what it printed, and a defective check is re-authored with the rule that makes it passable", async () => {
  const { makeDiagnoser } = await import("./diagnose");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-diag-"));
  fs.mkdirSync(path.join(root, "probes"), { recursive: true });
  const rel = "probes/space__SL-7_AC-4.test.mjs";
  fs.writeFileSync(
    path.join(root, rel),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `test("first", () => assert.ok(true));\n` +
      `test("second", () => assert.match("", /never/, "the bar reports the run"));\n`,
  );
  let judgePrompt = "";
  const ran: string[] = [];
  const reauthored: { ac: number; why: string }[] = [];
  const rulings: unknown[] = [];
  const said: string[] = [];
  const diagnose = makeDiagnoser(
    {
      wtRoot: path.join(root, "wt"),
      tep: "TEP-x",
      testerWt: root,
      model: "sonnet",
      sliceProbes: new Map([["SL-7", [rel]]]),
      sliceVerifs: new Map([["SL-7", [{ ac: 4, run: `node --test ${rel}` }]]]),
      criterionOf: () => ({ id: "c4", text: "the bar reports the run of the space it is given" }),
      // The runner's own words (node --test cannot recurse inside a test run).
      boundedExec: async (cmd: string, cwd: string) => {
        ran.push(`${cmd} @ ${cwd}`);
        return {
          code: 1,
          output: "ok 1 - first\nnot ok 2 - second\n  error: 'the bar reports the run'\n  expected:\n  actual: ''\n# fail 1\n",
        };
      },
      supervisorRound: async (_d: unknown, prompt: string) => {
        judgePrompt = prompt;
        return "DEFECTIVE: both tests share the module loaded once, so the second reads a bar nothing wrote to.";
      },
      log: (l: string) => said.push(l),
      defect: () => {},
      onRuling: (r: unknown) => rulings.push(r),
    } as never,
    async (_slice: string, ac: number, why: string) => {
      reauthored.push({ ac, why });
      return true;
    },
  );

  const out = await diagnose("SL-7", 4, "AssertionError [ERR_ASSERTION]\n  expected:\n  actual: ''\n  operator: 'match'");
  assert.ok(out?.reauthored, "a defective check is re-authored");
  assert.match(judgePrompt, /WHAT IT PRINTED[\s\S]*not ok 2 - second/, "the judge is given what the check printed when RUN, not the source alone");
  assert.match(ran[0], /node --test probes\/space__SL-7_AC-4\.test\.mjs @ .*oracle-runners\/TEP-x-SL-7$/, "run in the slice's own runner");
  assert.match(judgePrompt, /test\("second"/, "and the check's source");
  assert.match(judgePrompt, /the bar reports the run of the space it is given/, "and the criterion it must render");
  assert.match(judgePrompt, /INTERACTION its tests have with each other/, "and is told to read the file whole");
  assert.equal(reauthored[0].ac, 4);
  assert.match(reauthored[0].why, /share the module loaded once/, "the ruling's words reach the re-author");
  assert.match(out!.note, /CHECK 4 WAS DEFECTIVE[\s\S]*re-authored from its criterion/, "the coder is told, not left guessing");
  assert.ok(rulings.length === 1, "the ruling rides the delivery");
  assert.ok(said.some((l) => /the judge runs it and looks/.test(l)));
  assert.ok(await diagnose("SL-7", 4, "again"), "a re-authored check may be looked at once more");
  assert.equal(await diagnose("SL-7", 4, "and again"), undefined, "but a third look is a loop, and is refused");
});

test("SL-7's real evidence is recognised as saying nothing: a bullet list of failing test names is not a diff of values", async () => {
  const { uninformative } = await import("./diagnose");
  const real = [
    "AC-4: FAIL",
    "$ node --test probes/space__SL-7_AC-4.test.mjs → exit 1",
    "failing tests:",
    "  - heartbeat paints the status bar from the space actually given to it, when that space is running",
    "not ok 2 - heartbeat paints the status bar from the space actually given to it",
    "  error: 'the status bar reports the run of the space it was actually given'",
    "  code: 'ERR_ASSERTION'",
    "  expected:",
    "  actual: ''",
    "  operator: 'match'",
  ].join("\n");
  assert.equal(uninformative(real), true, "no value is shown — the coder has nothing to act on");
  const withValues = real.replace("  expected:\n  actual: ''", "  expected: 'building 2 units'\n  actual: 'idle'");
  assert.equal(uninformative(withValues), false);
  const nodeDiff = "AssertionError\n+ actual - expected\n\n+ ['a']\n- []\n";
  assert.equal(uninformative(nodeDiff), false, "a real diff of values is evidence");
});

test("a check may be challenged twice — the budget is per check, so questioning one check never starves another", async () => {
  const { makeChallenge } = await import("./oracle");
  const rulings: { granted: boolean }[] = [];
  const ch = makeChallenge({
    sliceProbes: new Map([["SL-7", ["probes/x__SL-7_AC-1.test.mjs", "probes/x__SL-7_AC-4.test.mjs"]]]),
    criterionOf: (_s: string, ac: number) => ({ id: `c${ac}`, text: `criterion ${ac}` }),
    testerWt: "/nowhere",
    model: "sonnet",
    log: () => {},
    defect: () => {},
    onRuling: (r: { granted: boolean }) => rulings.push(r),
    supervisorRound: async () => "FAITHFUL — it renders the criterion.",
  } as never)("SL-7");
  const a1 = await ch(1, "one");
  const a2 = await ch(1, "two");
  const a3 = await ch(1, "three");
  assert.match(a3, /check 1 has been challenged 2 times/, "the third on the SAME check is refused");
  const other = await ch(4, "the check that is actually wrong");
  assert.doesNotMatch(other, /has been challenged/, "another check still has its own budget");
  void a1;
  void a2;
});
