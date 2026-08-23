/**
 * What the machine refuses before anyone is graded.
 *
 * Every fault here cost a whole run in the field, and every one of them is
 * decidable the moment a check is written — before a coder starts, while
 * the cheapest thing to change is one file nobody has built against yet.
 *
 * These are properties, not incidents: each states a kind of check that can
 * never be evidence, and each is driven by the smallest check of that kind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { auditProbe } from "./probeAudit";
import { refusedBeforeDispatch, skeletonFirst } from "./refusals";
import { repairByAuthors } from "./authorRepair";
import { setupRunTree } from "./setup";
import { factsOf, rememberFacts } from "./facts";
import { classMethodsIn, wrongAltitude } from "./altitude";
import { rehouseChecks } from "./checkHomes";
import { writeDeliveryRecord } from "./plan";
import { acceptDelivery } from "../gates/sign";
import type { Delivery } from "../core/schema";
import * as os from "node:os";
import { emptySpace } from "../core/schema";

/** A repository with one directory, so the import audit has ground truth. */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-audit-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "greet.mjs"), "export const greet = () => 'hello';\n");
  return dir;
}

const PLANNED = ["src/greet.mjs"];


/** The pre-flight as the run calls it, with the repository stood in for. */
async function refusedBeforeDispatchIn(a: { slices: unknown[]; space: unknown }): Promise<string[]> {
  const r = await refusedBeforeDispatch({
    slices: a.slices as never,
    space: a.space as never,
    cut: { id: "cut-1", changeIds: ["n1"] },
    repoRoot: "/nowhere",
    exec: async () => ({ code: 0, out: "" }),
    log: () => {},
  });
  return r.refusal ? r.refusal.refusal.split("\n") : [];
}

test("a check that reads the source instead of driving it is refused", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { readFileSync } from "node:fs";\n` +
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { greet } from "./greet.mjs";\n` +
      `test("greet exists", () => assert.match(readFileSync("src/greet.mjs", "utf8"), /hello/));\n`,
    repo(),
    PLANNED,
  );
  assert.equal(faults.filter((f) => f.kind === "source-text").length, 1, JSON.stringify(faults));
  assert.match(faults[0].detail, /Drive the behaviour instead/);
});

test("a check that imports nothing this cut builds is refused", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `test("two is two", () => assert.equal(2, 2));\n`,
    repo(),
    PLANNED,
  );
  assert.equal(faults.filter((f) => f.kind === "drives-nothing").length, 1, JSON.stringify(faults));
});

test("a check that simulates a platform the repository does not own is refused", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import Module from "node:module";\nModule._load = () => ({ greet: () => "hello" });\n` +
      `import { greet } from "./greet.mjs";\nimport { test } from "node:test";\ntest("greet", () => greet());\n`,
    repo(),
    PLANNED,
  );
  assert.equal(faults.filter((f) => f.kind === "simulator").length, 1, JSON.stringify(faults));
});

test("a check that drives what the cut builds passes every refusal", () => {
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { greet } from "./greet.mjs";\ntest("greet", () => assert.equal(greet(), "hello"));\n`,
    repo(),
    PLANNED,
  );
  assert.deepEqual(faults, [], "an honest check is refused nothing");
});

test("a check reading a fixture is not a source-text check", () => {
  // The rule must not refuse the ordinary: reading data a test owns is how
  // half the world's tests are written.
  const faults = auditProbe(
    "src/greet_AC-1.test.mjs",
    `import { readFileSync } from "node:fs";\n` +
      `import { greet } from "./greet.mjs";\nimport { test } from "node:test";\n` +
      `test("greet", () => greet(readFileSync("fixtures/names.txt", "utf8")));\n`,
    repo(),
    PLANNED,
  );
  assert.deepEqual(
    faults.filter((f) => f.kind === "source-text"),
    [],
    "reading a fixture is not reading the source",
  );
});

/**
 * And what the machine refuses before it dispatches anybody — read from the
 * plan, said in the person's own words, with no worker started.
 */
test("a promise landing in two repositories is refused before any worker", async () => {
  const refusals = await refusedBeforeDispatchIn({
    slices: [
      {
        handle: "SL-1",
        status: "ready",
        files: ["src/greet.mjs"],
        workUnits: [{ footprint: ["src/greet.mjs"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      } as never,
    ],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "greet the user everywhere",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "greet() returns hello" }],
          grounding: {
            touchpoints: [
              { path: "src/greet.mjs", planned: true, scope: "web" },
              { path: "src/greet.mjs", planned: true, scope: "api" },
            ],
            stamp: [],
          },
        },
      ],
    },
  });
  assert.equal(refusals.length, 1, JSON.stringify(refusals));
  assert.match(refusals[0], /more than one repository/);
  assert.match(refusals[0], /greet the user everywhere/, "the person's own words, not a file");
});

test("a promise whose only site its unit may not change is refused before any worker", async () => {
  const refusals = await refusedBeforeDispatchIn({
    slices: [
      {
        handle: "SL-7",
        status: "ready",
        files: ["src/panel.mjs"],
        workUnits: [{ footprint: ["src/panel.mjs"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      } as never,
    ],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "one editor tab per thinking space",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "opening a space twice reveals the same tab" }],
          grounding: { touchpoints: [{ path: "src/extension.mjs", planned: false }], stamp: [] },
        },
      ],
    },
  });
  assert.equal(refusals.length, 1, JSON.stringify(refusals));
  assert.match(refusals[0], /may not change src\/extension\.mjs/);
});

test("a promise its unit can reach, in one repository, is refused nothing", async () => {
  const refusals = await refusedBeforeDispatchIn({
    slices: [
      {
        handle: "SL-1",
        status: "ready",
        files: ["src/greet.mjs"],
        workUnits: [{ footprint: ["src/greet.mjs"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      } as never,
    ],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "greet the user",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "greet() returns hello" }],
          grounding: { touchpoints: [{ path: "src/greet.mjs", planned: true }], stamp: [] },
        },
      ],
    },
  });
  assert.deepEqual(refusals, []);
});

test("the plan runs a thin end-to-end path first", () => {
  const slice = (handle: string, file: string): never =>
    ({ handle, status: "ready", files: [file], workUnits: [{ footprint: [file], execution: "serial", role: "code" }] }) as never;
  const ordered = skeletonFirst([slice("SL-1", "src/deep/core.mjs"), slice("SL-2", "src/main.mjs")], ["src/main.mjs"]);
  assert.deepEqual(
    ordered.map((s) => s.handle),
    ["SL-2", "SL-1"],
    "the slice that reaches the product's outer seam goes first",
  );
});

/**
 * A repair goes back to the author that wrote the code, in its own session.
 * The evidence for that is the session id the worker is resumed with — a
 * fresh worker carries none, which is exactly the failure this replaces.
 */
test("a red criterion is repaired as the next message in its author's own session", async () => {
  const resumedWith: (string | undefined)[] = [];
  const said: string[] = [];
  const results = await repairByAuthors({
    reds: [
      { unit: "SL-1#eu-0", text: "greet() returns hello", evidence: "expected 'hello', got 'hi'", footprint: ["src/greet.mjs"] },
      { unit: "SL-2#eu-0", text: "the panel opens once", evidence: "two panels", footprint: ["src/panel.mjs"] },
    ],
    sessionOf: (unit) => (unit === "SL-1#eu-0" ? "session-abc" : undefined),
    changedSince: ["src/other.mjs"],
    worktree: "/nowhere",
    model: "sonnet",
    worker: async (deps, brief) => {
      resumedWith.push(deps.resume);
      assert.match(brief, /THE PROMISE: greet\(\) returns hello/);
      assert.match(brief, /expected 'hello', got 'hi'/);
      assert.match(brief, /src\/other\.mjs/, "and what changed since it stopped");
      return { ok: true, finalText: "UNDELIVERED: none" };
    },
    log: (l) => said.push(l),
    defect: () => {},
  });

  assert.deepEqual(resumedWith, ["session-abc"], "the author is resumed, and only where a session survives");
  assert.deepEqual(
    results.map((r) => r.resumed),
    [true, false],
  );
  assert.match(results[1].why, /no session/);
  assert.ok(said.some((l) => /its session is gone/.test(l)), "a lost session is said, never skipped in silence");
});

/**
 * The door: a run must not die installing what the checkout beside it
 * already holds. Two headless runs were killed for their memory doing
 * exactly that.
 */
test("the door borrows the checkout's provisioning instead of installing again", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-base-"));
  fs.mkdirSync(path.join(base, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(base, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  const ran: string[] = [];
  const said: string[] = [];
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    provision: "npm ci",
    exec: async (cmd, args, cwd) =>
      cmd === "git" && args[2] === "status"
        ? { code: 0, out: cwd === base ? "!! node_modules/\n" : "" }
        : { code: 0, out: "" },
    boundedExec: async (cmd) => {
      ran.push(cmd);
      return { code: 0, output: "" };
    },
    log: (l) => said.push(l),
  });

  assert.deepEqual(ran, [], "the install never ran");
  assert.deepEqual(setup.provisioned, ["node_modules"], "and the run still knows what it has");
  assert.ok(fs.existsSync(path.join(wt, "node_modules", "dep", "index.js")), "the dependency is reachable in the worktree");
  assert.ok(said.some((l) => /borrowing the checkout's node_modules/.test(l)));
});

test("the door borrows even when no install command was ever learned", async () => {
  // Run 2 of the acceptance died here: no install command was known, so
  // nothing was borrowed and nothing was installed, and the suite failed
  // before its first test on a tree missing its dependencies.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-base-"));
  fs.mkdirSync(path.join(base, "webview", "map", "node_modules", "vite"), { recursive: true });
  fs.writeFileSync(path.join(base, "webview", "map", "node_modules", "vite", "index.js"), "");
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    exec: async (cmd, args, cwd) =>
      cmd === "git" && args[2] === "status"
        ? { code: 0, out: cwd === base ? "!! webview/map/node_modules/\n" : "" }
        : { code: 0, out: "" },
    boundedExec: async () => ({ code: 0, output: "" }),
    log: () => {},
  });
  assert.deepEqual(setup.provisioned, ["webview/map/node_modules"]);
  assert.ok(
    fs.existsSync(path.join(wt, "webview", "map", "node_modules", "vite", "index.js")),
    "a nested dependency directory is lent too",
  );
});

test("the borrow lends dependency stores and nothing else", async () => {
  // Run 4 judged the wrong tree: the borrow lent out-test/ as a symlink, so
  // the worktree's suite compiled through it INTO the base checkout and ran
  // the base's code. Seven reds against work that was finished.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-base-"));
  for (const d of ["node_modules", "out-test", "out", "media", "coverage"])
    fs.mkdirSync(path.join(base, d), { recursive: true });
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wt-"));
  const setup = await setupRunTree({
    worktree: wt,
    repoRoot: base,
    exec: async (cmd, args, cwd) =>
      cmd === "git" && args[2] === "status"
        ? {
            code: 0,
            out:
              cwd === base
                ? "!! node_modules/\n!! out-test/\n!! out/\n!! media/\n!! coverage/\n!! thinkube-tandem-2.0.144.vsix\n"
                : "",
          }
        : { code: 0, out: "" },
    boundedExec: async () => ({ code: 0, output: "" }),
    log: () => {},
  });
  assert.deepEqual(setup.provisioned, ["node_modules"], "only the dependency store crossed");
  for (const d of ["out-test", "out", "media", "coverage", "thinkube-tandem-2.0.144.vsix"])
    assert.ok(!fs.existsSync(path.join(wt, d)), `${d} was lent — the run would judge the base's tree`);
});

test("the four facts about a repository are kept in the repository", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-facts-"));
  assert.equal(factsOf(repo), undefined, "a repository never run against tells nothing");

  rememberFacts(repo, { provision: "npm ci", prepare: "npm run build", runOne: "node --test <file>" }, "2026-08-22T20:00:00Z");
  const told = factsOf(repo);
  assert.equal(told?.provision, "npm ci");
  assert.equal(told?.runOne, "node --test <file>");
  assert.equal(told?.provenAt, "2026-08-22T20:00:00Z", "and says when it was proved");

  // A repository that cannot be written to still runs: a file where the
  // directory would go makes the write impossible, and nothing throws.
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-blocked-"));
  fs.writeFileSync(path.join(blocked, ".tandem"), "not a directory\n");
  assert.doesNotThrow(() => rememberFacts(blocked, { provision: "", prepare: "", runOne: "" }, "now"));
  assert.equal(factsOf(blocked), undefined, "and it simply asks again next time");
});




/**
 * Altitude — the rule the whole methodology exists for. A criterion that
 * can only be checked by building a class and calling it is a criterion
 * whose check passes for a part connected to nothing.
 */
const METHODS = [
  { className: "SpacePanel", method: "reveal", file: "src/surfaces/panel.ts" },
  { className: "SpacePanel", method: "show", file: "src/surfaces/panel.ts" },
];

test("a criterion that can only be checked by calling a class method is refused", () => {
  const why = wrongAltitude({
    criterion: "SpacePanel.reveal() sets the active tab",
    methods: METHODS,
    exported: () => false,
  });
  assert.ok(why, "it is refused");
  assert.match(why!, /building SpacePanel and calling reveal/);
  assert.match(why!, /Say what the product must DO/, "and it says what to write instead");
});

test("a criterion about what the product does is not refused", () => {
  for (const text of [
    "opening the same space twice reveals the one tab, never a second",
    "greet() returns 'hello'",
    "the delivery page shows one row per cut",
  ])
    assert.equal(
      wrongAltitude({ criterion: text, methods: METHODS, exported: (s) => s === "greet" }),
      undefined,
      `refused an honest criterion: ${text}`,
    );
});

test("a criterion naming a method the module also exports is at the seam", () => {
  // A library's public function IS the outer seam, even when a class of the
  // same name has a method beside it.
  assert.equal(
    wrongAltitude({ criterion: "`show()` opens the panel", methods: METHODS, exported: (s) => s === "show" }),
    undefined,
  );
});

test("the class methods come from the code map the machine already builds", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-graph-"));
  const graph = path.join(dir, "graph.json");
  fs.writeFileSync(
    graph,
    JSON.stringify({
      nodes: [
        { id: "cls", label: "SpacePanel", source_file: "src/surfaces/panel.ts" },
        { id: "m1", label: ".reveal()", source_file: "src/surfaces/panel.ts" },
        { id: "m2", label: ".constructor()", source_file: "src/surfaces/panel.ts" },
      ],
      links: [
        { relation: "method", source: "cls", target: "m1" },
        { relation: "method", source: "cls", target: "m2" },
        { relation: "imports", source: "cls", target: "m1" },
      ],
    }),
  );
  assert.deepEqual(classMethodsIn(graph), [
    { className: "SpacePanel", method: "reveal", file: "src/surfaces/panel.ts" },
  ]);
  assert.deepEqual(classMethodsIn(path.join(dir, "absent.json")), [], "no map is never a refusal");
});





/**
 * What reaches a person is about the work.
 *
 * Not a word list over arbitrary text — that would pass anything phrased
 * carefully. These are the machine's OWN messages, produced by the real
 * functions with real inputs, and read for the two things a person can do
 * nothing with: the name of a tool, and the name of a part of the run.
 */
const INTERNALS =
  /\b(oracle|probe|footprint|worktree|dag|frontier|knip|tsc|npx|Bash|Grep|Glob|NotebookEdit|eu-\d|#eu|mcp__|stdout|stderr|regex)\b/i;

test("every refusal a person reads is about the work, not about the machine", async () => {
  const said: string[] = [];

  // The pre-flight refusals, from the real function.
  const impossible = await refusedBeforeDispatchIn({
    slices: [
      {
        handle: "SL-1",
        status: "ready",
        files: ["src/panel.ts"],
        workUnits: [{ footprint: ["src/panel.ts"], execution: "serial", role: "code" }],
        criterionIds: ["c1"],
      },
    ],
    space: {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "one editor tab per thinking space",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "opening a space twice reveals the same tab" }],
          grounding: { touchpoints: [{ path: "src/extension.ts", planned: false }], stamp: [] },
        },
      ],
    },
  });
  said.push(...impossible);

  // What acceptance refuses, in each of its shapes.
  for (const d of [
    { id: "d1", cutId: "c", branch: "tandem/TEP-1", proofs: [], withheld: "two promises are not kept" },
    { id: "d2", cutId: "c", branch: "tandem/TEP-1", proofs: [{ kind: "probe" as const, label: "it works", verdict: "red" as const }] },
  ] as Delivery[]) {
    const r = acceptDelivery(d, "2026-08-22T00:00:00Z", "advisory", []);
    if (!r.ok) said.push(r.reason);
  }

  // The altitude refusal, which has the most to explain.
  const why = wrongAltitude({
    criterion: "SpacePanel.reveal() sets the active tab",
    methods: [{ className: "SpacePanel", method: "reveal", file: "src/surfaces/panel.ts" }],
    exported: () => false,
  });
  if (why) said.push(why);

  const offending = said.filter((line) => INTERNALS.test(line));
  assert.deepEqual(offending, [], `these name the machine rather than the work:\n${offending.join("\n")}`);
  assert.ok(said.length >= 4, `the drive read nothing: ${said.length}`);
});

test("what the door lends can never be committed, even by add -A", async () => {
  // Run 4's withheld commit ran `git add -A` and committed four borrowed
  // symlinks onto the branch — the repository's own `node_modules/` ignore
  // matches a directory, not a symlink. After that, every fresh checkout of
  // the branch recreated links into the base checkout and the suite judged
  // the wrong tree, run after run.
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-real-base-"));
  execFileSync("git", ["init", "-q", base]);
  g(base, "config", "user.email", "t@t");
  g(base, "config", "user.name", "t");
  fs.writeFileSync(path.join(base, "a.txt"), "a\n");
  fs.writeFileSync(path.join(base, ".gitignore"), "node_modules/\n");
  fs.mkdirSync(path.join(base, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(base, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  g(base, "add", "a.txt", ".gitignore");
  g(base, "commit", "-qm", "seed");
  const wt = path.join(base, "..", `${path.basename(base)}-wt`);
  g(base, "worktree", "add", "-q", "-b", "run", wt);

  const exec = async (cmd: string, args: string[], cwd: string) => {
    try {
      return { code: 0, out: execFileSync(cmd, ["-C", cwd, ...args.slice(2)], { encoding: "utf8" }) };
    } catch (err) {
      return { code: 1, out: String((err as { stdout?: string }).stdout ?? "") };
    }
  };
  await setupRunTree({ worktree: wt, repoRoot: base, exec: exec as never, boundedExec: async () => ({ code: 0, output: "" }), log: () => {} });

  assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "the dependency store was lent as a link");
  g(wt, "add", "-A", ".");
  assert.equal(
    g(wt, "status", "--porcelain").split("\n").filter((l: string) => l.includes("node_modules")).join(""),
    "",
    "and add -A cannot stage it",
  );
});

test("a check an earlier run already wrote keeps its address", () => {
  // A resumed run once judged 64 criteria red: every check existed on the
  // branch at probes/, and the plan had been renamed to expect them beside
  // their subjects — an address nobody would ever create, because the
  // testers' slices were already standing.
  const slices = [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: ["src/greet.mjs"] },
        { role: "test", footprint: ["probes/x__SL-1_AC-1.test.mjs"] },
      ],
    },
  ];
  const moved = rehouseChecks(
    slices as never,
    ["src/greet.mjs", "src/greet.test.mjs"],
    new Set(["probes/x__SL-1_AC-1.test.mjs"]),
  );
  assert.deepEqual(moved, [], "nothing moves");
  assert.deepEqual(
    (slices[0].workUnits[1] as { footprint: string[] }).footprint,
    ["probes/x__SL-1_AC-1.test.mjs"],
    "the plan still points at the check that exists",
  );
});

test("what an opened delivery recorded outlives every later failed run", async () => {
  // A withheld run once overwrote a good record's fifty-eight check
  // sources with entries at the wrong addresses, and the restore that
  // depends on the record had nothing left to restore from.
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-record-"));
  const base = { tep: "TEP-1", branch: "b", baseSha: "x", proofs: [], undelivered: [], verifs: [], acResults: [] };
  await writeDeliveryRecord(store, {
    ...base,
    checks: [{ criterionId: "c1", path: "probes/a.test.mjs", source: "the real check" }],
  } as never);
  // The failed run writes its record without checks — and takes nothing.
  await writeDeliveryRecord(store, base as never);
  const kept = JSON.parse(fs.readFileSync(path.join(store, "deliveries", "TEP-1.json"), "utf8")) as {
    checks?: { path: string; source: string }[];
  };
  assert.equal(kept.checks?.length, 1);
  assert.equal(kept.checks?.[0].source, "the real check");
});
