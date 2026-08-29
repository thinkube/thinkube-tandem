/**
 * What the closing gate judges, and what it must never judge.
 *
 * These were filed with the coupling checks because both live at the end
 * of a run. They are a different subject: coupling is about which slices
 * may proceed together; this is about what the gate reads, in whose
 * words, and whose failure a red belongs to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refusedBeforeDispatch } from "./refusals";
import { rehouseChecks } from "./checkHomes";
import { proved } from "./proved";
import { closingVerifications, confessedDeferrals } from "./plan";
import { pinRecordedChecks } from "./checkHomes";
import { knotWarnings } from "./refusals";
import { missingProbes } from "./testHomes";
import { gradeAssessments } from "./assess";
import { provedByExecution } from "./wiring";
import { platformImitations } from "./probeAudit";
import { outsideFootprint } from "./answers";
import { clearanceLesson } from "./worker";
import { emptySpace } from "../core/schema";

/**
 * What the closing gate is judging, and how it runs what it judges.
 *
 * A check runs the way THIS repository runs a test — a command from
 * another language reports "not found" and reads as the code failing. What
 * is judged is the lines this run wrote, not the ones it found. A check
 * that executed nothing says what it DID execute, so the finding can be
 * acted on. And production that imitates the platform is named by file and
 * line, as a finding for the person, never a veto.
 */
test("the gate judges this run's work, by this repository's own way of running a check", async () => {
  {
  // Ten promises passed their slice's oracle and were judged red at the
  // closing gate, all ten identically. The oracle used the command the
  // door PROVED for this repository; the gate used a hardcoded
  // `node --test <path>` on the TypeScript source, which this repository
  // never runs — its tests are compiled first. The two disagreed about
  // the same files, and the delivery was withheld on the gate's answer.
  const slices = [
    {
      handle: "SL-1",
      status: "ready",
      files: [],
      workUnits: [
        { role: "code", footprint: ["src/core/schema.ts"], execution: "serial" },
        { role: "test", footprint: ["probes/x__SL-1_AC-1.test.mjs"], execution: "serial" },
      ],
    },
  ];
  const runOne = `node --test "out-test/$(echo '<file>' | sed -e 's|^src/||' -e 's|\\.ts$|.js|')"`;
  const withFact = closingVerifications(slices as never, proved(runOne, true)!);
  assert.equal(
    withFact.verifs[0].run,
    `node --test "out-test/$(echo 'probes/x__SL-1_AC-1.test.mjs' | sed -e 's|^src/||' -e 's|\\.ts$|.js|')"`,
    "the gate ignored the repository's own way of running one test",
  );
  // There is no "no fact proved" case any more. A check with no proved
  // command used to fall back to `node --test <probe>`; in a repository
  // that is not JavaScript that command does not exist, every check was
  // red, and a red check is an unkept promise — the machine's ignorance
  // reported as the person's work failing. The run now refuses at the
  // door instead, and the type makes the fallback unwritable.
  }
  {
  // A run that touched the deferral machinery was handed its own source
  // back as four confessions: the regular expression that DEFINES the
  // marker words, the code that FORMATS the report, and a fixture. None
  // was a deferral, and the delivery said the work was dishonest for them.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-confess-"));
  const git = (...a: string[]) =>
    require("node:child_process").execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // Already in the tree: a line that TALKS about the vocabulary.
  fs.writeFileSync(path.join(repo, "scan.ts"), 'const MARKERS = /\\b(TODO|FIXME)\\b/;\nexport const x = 1;\n');
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  // This run changes that file for an unrelated reason, and confesses in another.
  fs.writeFileSync(path.join(repo, "scan.ts"), 'const MARKERS = /\\b(TODO|FIXME)\\b/;\nexport const x = 2;\n');
  fs.writeFileSync(path.join(repo, "work.ts"), "export function pay() {\n  // TODO: the refund path is not built\n}\n");
  git("add", "-A");
  git("commit", "-qm", "the run");

  const said = await confessedDeferrals({
    worktree: repo,
    baseSha: base,
    exec: async (cmd, a, cwd) => ({
      code: 0,
      out: require("node:child_process").execFileSync(cmd, a, { cwd, encoding: "utf8" }),
    }),
    extraPaths: [],
    onHit: () => {},
  });
  assert.equal(said.length, 1, `expected only the run's own confession, got:\n${said.join("\n")}`);
  assert.match(said[0], /work\.ts:2 confesses a deferral/);
  assert.doesNotMatch(said.join("\n"), /scan\.ts/, "the marker it found in the tree is not its confession");
  }
  {
  // Six of these once came back within one second — execs that plainly
  // never ran a check — and the bare sentence gave nothing to notice that
  // with: three hand reproductions said yes while the run said no.
  const dirHolder = { files: ["out-test/hygiene.test.js", "out-test/run/state.js"] };
  const v = await provedByExecution({
    run: "node --test out-test/x.test.js",
    subjects: ["src/surfaces/phase.ts"],
    worktree: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wire-")),
    exec: async (cmd: string) => {
      // Simulate a run whose coverage saw other files, never the subject.
      const m = /NODE_V8_COVERAGE='([^']+)'/.exec(cmd)!;
      fs.writeFileSync(
        path.join(m[1], "coverage-1.json"),
        JSON.stringify({ result: dirHolder.files.map((f) => ({ url: `file:///w/${f}`, functions: [{ ranges: [{ count: 1 }] }] })) }),
      );
      return { code: 0, output: "ok" };
    },
  });
  assert.equal(v.executed, "no");
  assert.match(v.detail, /exit 0 in \d+ms/, "the verdict hides its exit and timing");
  assert.match(v.detail, /it did execute: /, "the verdict hides what the trace saw");
  }
  {
  // The simulator rule reads checks and knows a simulator by loader
  // interception. So the imitation moved to production: a hand-built
  // object literal cast to the platform's own type, keeping a test double
  // alive past the injected seam — steered there by the supervisor. Found
  // in a delivered panel.ts, invisible to every rule that existed.
  const hits = platformImitations(
    "src/surfaces/panel.ts",
    [
      'import type * as vscodeTypes from "vscode";',
      "function joinUri(base: vscodeTypes.Uri, ...segments: string[]): vscodeTypes.Uri {",
      "  const fsPath = path.join(base.fsPath, ...segments);",
      "  return { ...base, fsPath, path: fsPath, toString: () => fsPath } as vscodeTypes.Uri;",
      "}",
    ].join("\n"),
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 4);
  assert.match(hits[0].detail, /manufacturing a vscode object/);
  assert.match(hits[0].detail, /widen the seam instead/);
  // A relative import's namespace is the repository's own — not a platform.
  assert.deepEqual(
    platformImitations("src/a.ts", 'import type * as own from "./schema";\nconst x = {} as own.Cut;'),
    [],
  );
  }
});
/**
 * Resuming a branch an earlier run left.
 *
 * Its work stands only where it satisfies the plan running NOW — a slice
 * that satisfied an older plan is not done. And every check keeps the
 * address it was recorded at, so a tester is never asked to write again
 * what a delivery deliberately moved.
 */
test("a resumed run keeps the plan that is running now, and every check's address", async () => {
  {
  // A slice was taken as done because an earlier run had committed it,
  // while the plan had grown from ten checks to sixteen. The six the plan
  // added were never written, the tester was marked done without running,
  // and the failure surfaced two units later as a maintainer that could
  // not reach green — naming nothing a person could act on.
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-standing-"));
  fs.mkdirSync(path.join(tree, "src", "core"), { recursive: true });
  for (let i = 1; i <= 10; i++)
    fs.writeFileSync(path.join(tree, "src", "core", `schema_AC-${i}.test.ts`), "// written by the earlier run\n");
  const planNow = Array.from({ length: 16 }, (_, i) => `src/core/schema_AC-${i + 1}.test.ts`);
  const owed = await missingProbes(tree, planNow);
  assert.deepEqual(
    owed.map((f) => path.basename(f)),
    ["schema_AC-11.test.ts", "schema_AC-12.test.ts", "schema_AC-13.test.ts", "schema_AC-14.test.ts", "schema_AC-15.test.ts", "schema_AC-16.test.ts"],
    "the plan's own checks are what says whether an earlier run's work still stands",
  );
  // The plan it was committed for still stands, and nothing re-runs.
  assert.deepEqual(await missingProbes(tree, planNow.slice(0, 10)), []);
  }
  {
  // A resumed run rebuilds its plan from a space the run itself has
  // written into, so the same promises regroup and every check is minted
  // a fresh address. One resume renamed six criteria's checks out from
  // under their finished work: the plan expected files that did not
  // exist, a tester wrote new checks beside the wrong module, and the
  // gate graded six promises against checks that never drove their
  // subjects — in one second, exit 0.
  const slices = [
    {
      handle: "SL-2",
      criterionIds: ["c-render", "c-rail"],
      workUnits: [
        { role: "code", footprint: ["src/gates/render.ts"] },
        // The regrouped plan minted both beside render.ts…
        { role: "test", footprint: ["src/gates/render_AC-1.test.ts"] },
        { role: "test", footprint: ["src/gates/render_AC-2.test.ts"] },
      ],
    },
  ];
  const moved = pinRecordedChecks(
    slices as never,
    // …but the record knows the rail criterion's check lives elsewhere.
    new Map([["c-rail", "src/surfaces/railWaiveDocs_AC-1.test.ts"]]),
    new Set(["src/surfaces/railWaiveDocs_AC-1.test.ts", "src/gates/render_AC-1.test.ts"]),
  );
  assert.deepEqual(moved, [{ from: "src/gates/render_AC-2.test.ts", to: "src/surfaces/railWaiveDocs_AC-1.test.ts" }]);
  assert.deepEqual(
    slices[0].workUnits.filter((u) => u.role === "test").map((u) => u.footprint[0]),
    ["src/gates/render_AC-1.test.ts", "src/surfaces/railWaiveDocs_AC-1.test.ts"],
    "the recorded address wins; the unrecorded one keeps the plan's",
  );
  // A recorded address no longer on the branch cannot win — there is
  // nothing there to run.
  const gone = pinRecordedChecks(slices as never, new Map([["c-render", "src/x_AC-1.test.ts"]]), new Set());
  assert.deepEqual(gone, []);
  }
});
/**
 * A reviewer that has not finished.
 *
 * Still reading: asked to carry on. Never answering at all: the machine's
 * failure, recorded as such. Neither is a verdict about the code, and
 * grading either one red blames a person for a model's silence.
 */
test("a reviewer that has not answered is the machine's business, never the work's", async () => {
  {
  // A reviewer spent its flat budget of tool uses reading and was cut off
  // mid-sentence. The round returned an error, the error was recorded as
  // RED, and a delivery of twenty-four promises was withheld for a
  // criterion the closer then checked by hand and found kept. A count of
  // tool uses is not a verdict.
  const asked: string[] = [];
  const space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "the tabs carry their space's name", author: "t", at: "now" }],
    nodes: [
      {
        id: "n1",
        sentence: "each space opens in its own tab",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "the preflight no longer fails a run for a missing spec body", kind: "assessment" }],
        grounding: { touchpoints: [{ path: "src/a.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const run = async (_d: unknown, prompt: string): Promise<string | null> => {
    asked.push(prompt);
    // Cut off before a verdict the first time; answers when asked to finish.
    return asked.length === 1 ? null : "I read the preflight. It carries no spec-body provision.\nGREEN it is kept";
  };
  const graded = await gradeAssessments({
    space: space as never,
    cut: { id: "cut-1", changeIds: ["n1"] } as never,
    testerWt: "/nowhere",
    model: "sonnet",
    round: run as never,
  } as never);
  assert.equal(asked.length, 2, "it was not asked to carry on");
  assert.match(asked[1], /You have not answered yet/);
  assert.equal(graded.proofs.length, 1);
  assert.equal(graded.proofs[0].verdict, "green", "the reviewer's own word decides, not the counter");
  }
  {
  let saidUngraded = "";
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "each space opens in its own tab",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the notice names the space it came from", kind: "assessment" }],
      },
    ],
  };
  const graded = await gradeAssessments({
    space: space as never,
    cut: { id: "cut-1", changeIds: ["n1"] } as never,
    testerWt: "/nowhere",
    model: "sonnet",
    round: (async () => null) as never,
    ungraded: (label: string) => { saidUngraded = label; },
  } as never);
  assert.deepEqual(graded.proofs, [], "no verdict was invented in either direction");
  assert.equal(saidUngraded, "review-1", "the machine did not report its own failure");
  assert.match(graded.observations[0], /could not grade this/);
  assert.match(graded.observations[0], /Judge it yourself/);
  }
});
