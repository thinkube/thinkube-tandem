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
import { classMethodsIn, wrongAltitude } from "./altitude";
import { rehouseChecks } from "./checkHomes";
import { writeDeliveryRecord } from "./plan";
import { acceptDelivery } from "../gates/sign";
import type { Delivery } from "../core/schema";
import * as os from "node:os";
import { emptySpace } from "../core/schema";
import { exportedIn } from "./altitude";

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

/**
 * What the check audit refuses, and what it must not.
 *
 * One subject, five cases. The rule reads a check's own source and asks
 * whether it drives the thing it claims to prove: a check that reads the
 * source text instead of running it proves the file says something; one
 * that imports nothing this cut builds proves nothing at all; one that
 * replaces the platform proves the simulator works. The last two cases are
 * the other half of the rule — an honest check and a check reading its own
 * fixture must pass, or the rule refuses ordinary work.
 */
const AUDIT_CASES: {
  case: string;
  source: string;
  kind?: "source-text" | "drives-nothing" | "simulator";
  detail?: RegExp;
}[] = [
  {
    case: "reads the source instead of driving it",
    source:
      `import { readFileSync } from "node:fs";\n` +
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { greet } from "./greet.mjs";\n` +
      `test("greet exists", () => assert.match(readFileSync("src/greet.mjs", "utf8"), /hello/));\n`,
    kind: "source-text",
    detail: /Drive the behaviour instead/,
  },
  {
    case: "imports nothing this cut builds",
    source:
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `test("two is two", () => assert.equal(2, 2));\n`,
    kind: "drives-nothing",
  },
  {
    case: "simulates a platform the repository does not own",
    source:
      `import Module from "node:module";\nModule._load = () => ({ greet: () => "hello" });\n` +
      `import { greet } from "./greet.mjs";\nimport { test } from "node:test";\ntest("greet", () => greet());\n`,
    kind: "simulator",
  },
  {
    case: "drives what the cut builds — refused nothing",
    source:
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
      `import { greet } from "./greet.mjs";\ntest("greet", () => assert.equal(greet(), "hello"));\n`,
  },
  {
    // Reading data a test owns is how half the world's tests are written.
    case: "reads its own fixture — not a source-text check",
    source:
      `import { readFileSync } from "node:fs";\n` +
      `import { greet } from "./greet.mjs";\nimport { test } from "node:test";\n` +
      `test("greet", () => greet(readFileSync("fixtures/names.txt", "utf8")));\n`,
  },
];

test("the check audit refuses a check that does not drive its subject, and nothing else", () => {
  for (const c of AUDIT_CASES) {
    const faults = auditProbe("src/greet_AC-1.test.mjs", c.source, repo(), PLANNED);
    if (!c.kind) {
      assert.deepEqual(faults, [], `${c.case}: an honest check is refused nothing`);
      continue;
    }
    const named = faults.filter((f) => f.kind === c.kind);
    assert.equal(named.length, 1, `${c.case}: ${JSON.stringify(faults)}`);
    if (c.detail) assert.match(named[0].detail, c.detail, c.case);
  }
});

/**
 * And what the machine refuses before it dispatches anybody — read from the
 * plan, said in the person's own words, with no worker started.
 */
/**
 * What the machine refuses before it dispatches anybody — read from the
 * plan, said in the person's own words, with no worker started.
 *
 * One subject, three cases: a promise that reaches into two repositories
 * cannot be delivered by one run; a promise whose only site its unit may
 * not change asks a unit to keep something it cannot reach; and a promise
 * that is neither must be refused nothing, or the rule refuses ordinary
 * work.
 */
test("the pre-flight refuses only a promise no unit could keep", async () => {
  {
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
  }
  {
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
  }
  {
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
  }
});

/**
 * How the plan behaves before and during a run.
 *
 * A thin end-to-end path runs first, so the shape is proved before the
 * depth. A red criterion goes back as the next message in the session that
 * wrote it, which is the only actor holding the context. And every refusal
 * a person reads names the work, never the machinery.
 */
test("the plan is ordered, repaired and refused in words about the work", async () => {
  {
  const slice = (handle: string, file: string): never =>
    ({ handle, status: "ready", files: [file], workUnits: [{ footprint: [file], execution: "serial", role: "code" }] }) as never;
  const ordered = skeletonFirst([slice("SL-1", "src/deep/core.mjs"), slice("SL-2", "src/main.mjs")], ["src/main.mjs"]);
  assert.deepEqual(
    ordered.map((s) => s.handle),
    ["SL-2", "SL-1"],
    "the slice that reaches the product's outer seam goes first",
  );
  }
  {
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
  }
  {
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
  }
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

/**
 * The altitude rule: what a criterion may be checked BY.
 *
 * One subject, three cases. A criterion that can only be proved by
 * building a class and calling a method on it passes whether or not the
 * product ever reaches that code — so it is refused, and told what to
 * write instead. The other two cases are the rule's other half: an
 * ordinary criterion about what the product does must pass, and a name the
 * module itself hands out IS the outer seam, even when a class of the same
 * name has a method beside it.
 */
test("a criterion is refused when only a class method can check it, and not otherwise", () => {
  const why = wrongAltitude({
    criterion: "SpacePanel.reveal() sets the active tab",
    methods: METHODS,
    exported: () => false,
  });
  assert.ok(why, "it is refused");
  assert.match(why!, /building SpacePanel and calling reveal/);
  assert.match(why!, /Say what the product must DO/, "and it says what to write instead");

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

  // A library's public function IS the outer seam, even when a class of the
  // same name has a method beside it.
  assert.equal(
    wrongAltitude({ criterion: "`show()` opens the panel", methods: METHODS, exported: (s) => s === "show" }),
    undefined,
  );
});

/**
 * Reading what was already established.
 *
 * A check an earlier run wrote keeps its address; what an opened delivery
 * recorded outlives every failed run after it; the class methods come from
 * the code map the machine already builds. And a file that cannot be READ
 * is named rather than answered for — a file that is simply not there
 * hands out nothing, which is a fact about a promise's planned work.
 */
test("what an earlier run recorded survives, and what cannot be read is named", async () => {
  {
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
  }
  {
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
  }
  {
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
  }
  {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exp-"));
  const absent = exportedIn(root, ["src/planned.ts"]);
  assert.deepEqual(absent.unreadable, [], "a file to be created is not a fault");
  assert.equal(absent.exported("greet"), false);

  // A directory where a file is expected: it exists, and reading it fails.
  fs.mkdirSync(path.join(root, "src", "locked.ts"), { recursive: true });
  const blocked = exportedIn(root, ["src/locked.ts"]);
  assert.deepEqual(blocked.unreadable, ["src/locked.ts"], "the caller is told which file it could not see");
  }
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





