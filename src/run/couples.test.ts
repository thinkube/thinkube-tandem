/**
 * What the machine refuses when the plan's own parts collide.
 *
 * A slice is proven against what is committed plus its own files, and a
 * unit may write only inside its footprint. Both rules are load-bearing,
 * and both have a consequence the plan has to respect: two slices that
 * change what the other calls can never see each other, and two slices
 * driving one module must not be handed the same address for a check.
 *
 * Every case here was found the expensive way — a worker grinding rounds
 * against a state no edit of its own could reach — and every one of them
 * was decidable from the plan before anybody started.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refusedBeforeDispatch } from "./refusals";
import { rehouseChecks } from "./checkHomes";
import { closingVerifications, confessedDeferrals } from "./plan";
import { pinRecordedChecks } from "./checkHomes";
import { knotWarnings } from "./refusals";
import { missingProbes } from "./testHomes";
import { gradeAssessments } from "./assess";
import { provedByExecution } from "./wiring";
import { outsideFootprint } from "./answers";
import { clearanceLesson } from "./worker";
import { emptySpace } from "../core/schema";

/** A map file the door can read: file → the files it uses. */
function mapWith(uses: Record<string, string[]>): string {
  const at = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-map-")), "graph.json");
  const files = [...new Set([...Object.keys(uses), ...Object.values(uses).flat()])];
  const id = (f: string): string => f.replace(/[^\w]/g, "_");
  fs.writeFileSync(
    at,
    JSON.stringify({
      nodes: files.map((f) => ({ id: id(f), source_file: f })),
      links: Object.entries(uses).flatMap(([from, tos]) =>
        tos.map((to) => ({ relation: "imports", source: id(from), target: id(to), source_file: from })),
      ),
    }),
  );
  return at;
}

/** One slice owning one production file, responsible for one criterion. */
function slice(handle: string, file: string, criterion: string) {
  return {
    handle,
    status: "ready",
    files: [file],
    workUnits: [
      { footprint: [file], execution: "serial", role: "code" } as {
        footprint: string[];
        execution: string;
        role: string;
        consumes?: string[];
      },
    ],
    criterionIds: [criterion],
  };
}

/** Two promises, one landing in each slice's own file. */
function twoPromises() {
  return {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a space's tab carries its own name",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the tab shows the space's name" }],
        grounding: { touchpoints: [{ path: "src/surfaces/panel.ts", planned: true }], stamp: [] },
      },
      {
        id: "n2",
        sentence: "opening a space twice reveals the same tab",
        serves: [],
        needs: [],
        acceptance: [{ id: "c2", text: "opening twice reveals one tab" }],
        grounding: { touchpoints: [{ path: "src/extension.ts", planned: true }], stamp: [] },
      },
    ],
  };
}

test("two slices driving one module never mint the same check", () => {
  // A tester found another unit's finished checks at its own addresses,
  // asked what to do, was told in prose to use later numbers, and the
  // guard reverted the first file it wrote there — because prose does not
  // move a footprint. The ordinal counts within a slice; two slices on one
  // module both start at one, and beside that module that is one name.
  const slice = (handle: string, n: number) => ({
    handle,
    workUnits: [
      { role: "code", footprint: ["src/surfaces/panels.ts"] },
      {
        role: "test",
        footprint: Array.from({ length: n }, (_, i) => `probes/x__${handle}_AC-${i + 1}.test.mjs`),
      },
    ],
  });
  const slices = [slice("SL-6", 6), slice("SL-7", 7)];
  rehouseChecks(slices as never, ["src/surfaces/panels.ts", "src/surfaces/panels.test.ts"]);
  const homes = slices.flatMap((s) => (s.workUnits[1] as { footprint: string[] }).footprint);
  assert.equal(new Set(homes).size, homes.length, `two slices took the same address: ${homes.join(" ")}`);
  assert.equal(homes.length, 13);
});

test("a check is never minted onto a file the repository already has", () => {
  const slices = [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: ["src/greet.mjs"] },
        { role: "test", footprint: ["probes/x__SL-1_AC-1.test.mjs"] },
      ],
    },
  ];
  rehouseChecks(slices as never, ["src/greet.mjs", "src/greet.test.mjs", "src/greet_AC-1.test.mjs"]);
  assert.deepEqual(
    (slices[0].workUnits[1] as { footprint: string[] }).footprint,
    ["src/greet_AC-2.test.mjs"],
    "the address the repository already holds is not overwritten",
  );
});

test("two slices that change what the other calls are put in order, not refused", async () => {
  // SL-5 changed a constructor it owned; its only call site was in another
  // unit's hands. Each is proven against what is committed plus its own
  // files, so SL-5's runner held the new constructor and the old call and
  // could not compile. It ground twenty rounds against a state no edit
  // inside its clearance could reach, and reported a broken verifier.
  //
  // Refusing that plan only made the dead end arrive sooner: the person
  // does not write the plan and has no control that splits or orders it.
  // The map says which file calls which, and that settles the order.
  const graph = mapWith({ "src/extension.ts": ["src/surfaces/panel.ts"] });
  const slices = [
    slice("SL-5", "src/surfaces/panel.ts", "c1"),
    slice("SL-7", "src/extension.ts", "c2"),
  ];
  const r = await refusedBeforeDispatch({
    slices: slices as never,
    space: twoPromises() as never,
    cut: { id: "cut-1", changeIds: ["n1", "n2"] } as never,
    repoRoot: "/nowhere",
    graphPath: graph,
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  assert.equal(r.refusal, undefined, `the plan was refused instead of ordered: ${r.refusal?.refusal}`);
  const caller = slices.find((s) => s.handle === "SL-7")!;
  assert.deepEqual(
    caller.workUnits[0].consumes,
    ["src/surfaces/panel.ts"],
    "the caller now waits for the file it calls",
  );
  const later = r.dag.find((u) => u.slice === "SL-7" && u.role !== "test")!;
  assert.ok(
    later.requires.some((x) => x.startsWith("SL-5")),
    `the graph did not carry the edge: ${JSON.stringify(later.requires)}`,
  );
});

test("two slices that each use the other's work are watched, not refused", async () => {
  // This was refused as an unorderable knot. It refused a plan that had
  // already run and delivered twenty-two of its twenty-four promises: a
  // slice commits when it finishes, so the second of a coupled pair does
  // see the first's work. The sentence was wrong too — the two files it
  // named were the user side of two different edges, and neither imported
  // the other.
  const graph = mapWith({
    "src/extension.ts": ["src/surfaces/panel.ts"],
    "src/surfaces/panel.ts": ["src/extension.ts"],
  });
  const r = await refusedBeforeDispatch({
    slices: [
      slice("SL-5", "src/surfaces/panel.ts", "c1"),
      slice("SL-7", "src/extension.ts", "c2"),
    ] as never,
    space: twoPromises() as never,
    cut: { id: "cut-1", changeIds: ["n1", "n2"] } as never,
    repoRoot: "/nowhere",
    graphPath: graph,
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  assert.equal(r.refusal, undefined, `a coupling that a run can survive was refused: ${r.refusal?.refusal}`);
  const said = knotWarnings([{ a: "SL-5", b: "SL-7", one: "src/extension.ts", other: "src/surfaces/panel.ts" }]);
  assert.match(said[0], /each use something the other owns/);
  assert.match(said[0], /Watched, not refused/);
});
test("two slices joined by use are allowed when one waits for the other", async () => {
  const graph = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tandem-map-")), "graph.json");
  fs.writeFileSync(
    graph,
    JSON.stringify({
      nodes: [
        { id: "ext", source_file: "src/extension.ts" },
        { id: "panel", source_file: "src/surfaces/panel.ts" },
      ],
      links: [{ relation: "imports", source: "ext", target: "panel", source_file: "src/extension.ts" }],
    }),
  );
  const r = await refusedBeforeDispatch({
    slices: [
      {
        handle: "SL-5",
        status: "ready",
        files: ["src/surfaces/panel.ts"],
        workUnits: [{ footprint: ["src/surfaces/panel.ts"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      },
      {
        handle: "SL-7",
        status: "ready",
        files: ["src/extension.ts"],
        // It waits for what the other produces, so the earlier work is
        // committed before this one is ever verified.
        workUnits: [
          {
            footprint: ["src/extension.ts"],
            execution: "serial",
            role: "code",
            consumes: ["src/surfaces/panel.ts"],
          },
        ],
        criterionIds: ["c2"],
      },
    ] as never,
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "a space's tab carries its own name",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "the tab shows the space's name" }],
          grounding: { touchpoints: [{ path: "src/surfaces/panel.ts", planned: true }], stamp: [] },
        },
        {
          id: "n2",
          sentence: "opening a space twice reveals the same tab",
          serves: [],
          needs: [],
          acceptance: [{ id: "c2", text: "opening twice reveals one tab" }],
          grounding: { touchpoints: [{ path: "src/extension.ts", planned: true }], stamp: [] },
        },
      ],
    } as never,
    cut: { id: "cut-1", changeIds: ["n1", "n2"] } as never,
    repoRoot: "/nowhere",
    graphPath: graph,
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  assert.equal(r.refusal, undefined, JSON.stringify(r.refusal));
});

test("an answer that names files a unit may not write is not passed on", () => {
  // The supervisor renumbered a tester's checks in prose — "your real
  // footprint is AC-7 through AC-13". Prose does not move a footprint. The
  // worker did as it was told, the guard restored the first file it wrote
  // there, and the unit failed for obeying.
  const mine = ["src/surfaces/panels_AC-1.test.ts", "src/surfaces/panels_AC-7.test.ts"];
  assert.deepEqual(
    outsideFootprint("your real footprint is src/surfaces/panels_AC-8.test.ts through panels_AC-13.test.ts", mine),
    ["src/surfaces/panels_AC-8.test.ts"],
  );
  assert.deepEqual(
    outsideFootprint("write your assertions in src/surfaces/panels_AC-7.test.ts", mine),
    [],
    "a path the unit owns is not stray",
  );
  assert.deepEqual(
    outsideFootprint("the constructor now takes four arguments; assert on the title it was built with", mine),
    [],
    "an answer that names no file is left alone",
  );
});

test("the first write outside a clearance teaches; it does not end the unit", () => {
  // A coder found that its own criterion needed one additive line in a
  // table no slice owned. It knew the rule, quoted the half that says the
  // run clears you and you make the change yourself, dropped the half that
  // says ask first, and edited the file. The guard restored it and killed
  // the unit — discarding an hour of correct work for a line the run would
  // have granted.
  const said = clearanceLesson(["src/surfaces/phase.ts"], ["src/gates/render.ts", "src/surfaces/inbound.ts"]);
  assert.match(said, /src\/surfaces\/phase\.ts was restored/);
  assert.match(said, /not a refusal/, "the change is reachable — only the order was wrong");
  assert.match(said, /Say which file you need and which criterion requires it/);
  assert.match(said, /src\/gates\/render\.ts, src\/surfaces\/inbound\.ts/, "it says what may be written");
  assert.match(said, /again and the unit ends here/, "and that a second time is final");
});

test("the gate runs a check the way the repository runs a test", () => {
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
  const withFact = closingVerifications(slices as never, runOne);
  assert.equal(
    withFact.verifs[0].run,
    `node --test "out-test/$(echo 'probes/x__SL-1_AC-1.test.mjs' | sed -e 's|^src/||' -e 's|\\.ts$|.js|')"`,
    "the gate ignored the repository's own way of running one test",
  );
  // No fact proved: the plain command stands, as it always did.
  assert.equal(closingVerifications(slices as never).verifs[0].run, "node --test probes/x__SL-1_AC-1.test.mjs");
});

test("a slice only stands if it satisfies the plan that is running now", async () => {
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
});

test("the gate judges the lines this run wrote, not the ones it found", async () => {
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
});

test("a reviewer still reading is asked to carry on, never graded red", async () => {
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
});

test("a reviewer that never answers is the machine's failure, not the work's", async () => {
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
});

test("two slices sharing a file are not a knot", async () => {
  // Comparing each slice's whole footprint found a SHARED file using
  // another shared file and reported it both ways round — "sign.ts and
  // sign.ts call into each other's work". Five such knots refused a
  // re-run of work that had already been built and proved. A file both
  // slices are cleared for is shared ownership; the door's queue already
  // serialises two units writing one file.
  const graph = mapWith({ "src/gates/sign.ts": ["src/core/schema.ts"] });
  const shared = (handle: string) => ({
    handle,
    status: "ready",
    files: ["src/gates/sign.ts", "src/core/schema.ts"],
    workUnits: [
      { footprint: ["src/gates/sign.ts", "src/core/schema.ts"], execution: "serial", role: "code" } as {
        footprint: string[]; execution: string; role: string; consumes?: string[];
      },
    ],
    criterionIds: [],
  });
  const r = await refusedBeforeDispatch({
    slices: [shared("SL-2"), shared("SL-3")] as never,
    space: emptySpace() as never,
    cut: { id: "cut-1", changeIds: [] } as never,
    repoRoot: "/nowhere",
    graphPath: graph,
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  assert.equal(r.refusal, undefined, `sharing a file was called a knot: ${r.refusal?.refusal}`);
});

test("a wiring no-verdict names what did execute", async () => {
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
});

test("a resumed plan keeps every check at its recorded address", () => {
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
});
