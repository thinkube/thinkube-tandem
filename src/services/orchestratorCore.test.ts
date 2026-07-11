/**
 * Unit tests for the orchestrator's pure core — the slice picker and the
 * stream-json parser. node:test + node:assert; run via `npm test`. The live spawn / verify
 * / advance is a human verdict (low AI-testability), not covered here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pickNextSlice,
  pickFrontier,
  selectDisjoint,
  runWithConcurrency,
  batchExecutionUnits,
  extractDiagnosis,
  extractDiscoveries,
  buildTestReworkContext,
  buildAttendPrompt,
  buildRejectPrompt,
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
  buildUnitDag,
  readyFrontier,
  requiresSatisfied,
  buildWorkerPrompt,
  disallowedToolsForRole,
  stripAcceptanceCriteria,
  stripSatisfies,
  extractNeedsInput,
  sessionIdOf,
  NEEDS_INPUT_SENTINEL,
  parseAcVerifications,
  runAcVerifications,
  checkAcOrdinals,
  buildDeliveryReport,
  deliveryExitState,
  reDispatchDecision,
  isEscalated,
  hasEscalationMarker,
  markEscalated,
  MAX_REWORK_ATTEMPTS,
  ESCALATION_MARKER,
  CONTRACT_DEFECT_MARKER,
  buildVerificationTrace,
  mergeVerificationTrace,
  type ReDispatchVerdict,
  type SliceRow,
  type WorkUnit,
  type SliceForDag,
  type SchedulerState,
  type SchedUnit,
  type AcExec,
  type AcResult,
  type AcVerification,
  type AssessContext,
  type Fault,
  type VerificationTraceEntry,
  type ExitAction,
} from "./orchestratorCore";
import { validateDag } from "../methodology/parallelSlices";

test("pickNextSlice: first ready slice with all deps done is picked", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", requires: [] },
    { handle: "SP-1_SL-2", status: "ready", requires: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", requires: [] },
  ];
  assert.equal(pickNextSlice(rows), "SP-1_SL-2");
});

test("pickNextSlice: a ready slice with an unfinished dep is skipped", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "doing", requires: [] },
    { handle: "SP-1_SL-2", status: "ready", requires: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", requires: [] },
  ];
  // SL-2 blocked (dep doing); SL-3 free → SL-3.
  assert.equal(pickNextSlice(rows), "SP-1_SL-3");
});

test("pickNextSlice: a missing dep counts as not-done (blocks)", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-2", status: "ready", requires: ["SP-1_SL-99"] },
  ];
  assert.equal(pickNextSlice(rows), null);
});

test("pickNextSlice: nothing ready → null", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", requires: [] },
    { handle: "SP-1_SL-2", status: "doing", requires: [] },
  ];
  assert.equal(pickNextSlice(rows), null);
});

test("StreamJsonBuffer: reassembles lines split across chunks, skips blanks/garbage", () => {
  const b = new StreamJsonBuffer();
  assert.deepEqual(b.push('{"type":"sys'), []); // partial line held
  const evs = b.push(
    'tem","subtype":"init"}\n\nnot json\n{"type":"result","subtype":"success"}\n',
  );
  assert.equal(evs.length, 2);
  assert.equal(evs[0].type, "system");
  assert.equal(evs[1].type, "result");
});

test("StreamJsonBuffer: holds a trailing partial line until completed", () => {
  const b = new StreamJsonBuffer();
  assert.equal(b.push('{"type":"assistant"}\n{"type":"resu').length, 1);
  assert.equal(b.push('lt","subtype":"success"}\n').length, 1);
});

test("summarizeEvent: tool_use renders its input; results + snippets; non-display skip", () => {
  // tool_use shows WHAT the tool did, not just its name
  assert.equal(
    summarizeEvent({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    }),
    "▸ $ ls -la",
  );
  assert.equal(
    summarizeEvent({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "a.yaml" } },
        ],
      },
    }),
    "▸ Read a.yaml",
  );
  // tool_result shows the first line of output, indented under its call
  assert.equal(
    summarizeEvent({
      type: "user",
      message: {
        content: [{ type: "tool_result", content: "first line\nsecond" }],
      },
    }),
    "   ⤷ first line",
  );
  assert.equal(
    summarizeEvent({ type: "user", message: { content: [] } }),
    null,
  );
  assert.equal(
    summarizeEvent({ type: "result", subtype: "success" }),
    "✓ result: success",
  );
});

test("isResultSuccess: success vs error", () => {
  assert.equal(isResultSuccess({ type: "result", subtype: "success" }), true);
  assert.equal(
    isResultSuccess({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
    }),
    false,
  );
  assert.equal(isResultSuccess({ type: "assistant" }), false);
});

test("pickFrontier: returns ALL dispatchable slices in order (not just the head)", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", requires: [] },
    { handle: "SP-1_SL-2", status: "ready", requires: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", requires: ["SP-1_SL-99"] }, // blocked
    { handle: "SP-1_SL-4", status: "ready", requires: [] },
  ];
  assert.deepEqual(pickFrontier(rows), ["SP-1_SL-2", "SP-1_SL-4"]);
  assert.equal(pickNextSlice(rows), "SP-1_SL-2"); // still the head
});

test("selectDisjoint: skips a candidate whose footprint overlaps an earlier pick", () => {
  const picked = selectDisjoint([
    { handle: "A", footprint: ["src/a.ts"] },
    { handle: "B", footprint: ["src/a.ts", "src/b.ts"] }, // overlaps A
    { handle: "C", footprint: ["src/c.ts"] },
  ]);
  assert.deepEqual(picked, ["A", "C"]);
});

test("runWithConcurrency: never exceeds the cap, processes all, preserves order", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const worker = async (n: number) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
    return n * 2;
  };
  const out = await runWithConcurrency([0, 1, 2, 3, 4], 2, worker);
  assert.deepEqual(out, [0, 2, 4, 6, 8]);
  assert.ok(maxInFlight <= 2, `maxInFlight ${maxInFlight} should be ≤ 2`);
});

test("runWithConcurrency: cap floors to ≥1 and handles empty input", async () => {
  assert.deepEqual(await runWithConcurrency([], 4, async (x) => x), []);
  assert.deepEqual(
    await runWithConcurrency([1, 2], 0, async (x) => x * 10),
    [10, 20],
  );
});

test("extractDiagnosis: reads the ⚑ section, undefined when absent", () => {
  const body =
    "# A slice\n\nbody text\n\n## ⚑ Requires attention\n\nThe verifier was red.\n";
  assert.equal(extractDiagnosis(body), "The verifier was red.");
  assert.equal(extractDiagnosis("# A slice\n\nno flag here"), undefined);
});

test("SP-11/3: extractDiagnosis matches `## What happened` FIRST (delivery report), still falls back to `## ⚑ Requires attention`", () => {
  // A delivery report leads with `## What happened`; extractDiagnosis reads its prose, bounded by the
  // next `##` heading, so the divergence-priming caller can derive from the report itself.
  const report =
    "# Delivery — TEP-11_SP-3\n\nintro\n\n## What happened\n\nAC #2 diverged: the store never emits on reload.\n\n## Acceptance criteria\n\n- #1 — x — ✓ pass\n";
  assert.equal(
    extractDiagnosis(report),
    "AC #2 diverged: the store never emits on reload.",
  );
  // The existing slice-body caller (commands/orchestrate.ts) keeps working: no `## What happened` ⇒
  // the `## ⚑ Requires attention` heading is used.
  assert.equal(
    extractDiagnosis(
      "# A slice\n\n## ⚑ Requires attention\n\nThe verifier was red.\n",
    ),
    "The verifier was red.",
  );
  // An empty `## What happened` falls through to the ⚑ heading rather than returning "".
  assert.equal(
    extractDiagnosis(
      "## What happened\n\n\n## ⚑ Requires attention\n\nfallback text\n",
    ),
    "fallback text",
  );
});

test("SP-11/3: divergence for an attended session = extractDiagnosis(report), VERBATIM", () => {
  // 2026-07-11: no scrubbing — the fixer sees the failure as it is (the old
  // anti-gaming boundary blinded it to gate/footprint defects); independence
  // lives in the assessor/judge, never in hiding evidence from the fixer.
  const report =
    "# Delivery — TEP-11_SP-3\n\nintro\n\n## What happened\n\nAC #3 diverged: the token is dropped on reload.\n\n## Files\n\n- `a.ts`\n";
  const diagnosis = extractDiagnosis(report);
  assert.ok(diagnosis);
  assert.match(diagnosis!, /AC #3 diverged/); // the ordinal survives — verbatim
  assert.match(diagnosis!, /token is dropped on reload/);
});

test("SP-11/3: extractDiscoveries pulls items under a trailing `## Discoveries` heading, strips markers; [] when absent", () => {
  assert.deepEqual(extractDiscoveries("## Discoveries\n- a\n- b"), ["a", "b"]);
  // Mixed markers + numbered + paragraph lines, all trimmed and marker-stripped.
  assert.deepEqual(
    extractDiscoveries(
      "done the work.\n\n## Discoveries\n* first finding\n1. second finding\na bare paragraph line\n",
    ),
    ["first finding", "second finding", "a bare paragraph line"],
  );
  // The section ends at the next heading; earlier content is ignored.
  assert.deepEqual(
    extractDiscoveries("## Discoveries\n- keep me\n## After\n- drop me"),
    ["keep me"],
  );
  // A repeated heading → the TRAILING one wins.
  assert.deepEqual(
    extractDiscoveries("## Discoveries\n- old\n\n## Discoveries\n- new"),
    ["new"],
  );
  assert.deepEqual(extractDiscoveries("no discoveries heading here"), []);
  assert.deepEqual(extractDiscoveries(""), []);
});

test("SP-11/3: buildTestReworkContext returns the diagnosis VERBATIM only for route `test`, undefined otherwise", () => {
  const diag =
    "The probe asserts stale-store state that the contract never guarantees.";
  assert.equal(buildTestReworkContext(diag, "test"), diag); // verbatim
  assert.equal(buildTestReworkContext(diag, "code"), undefined);
  assert.equal(buildTestReworkContext(diag, undefined), undefined);
});

test("buildAttendPrompt: /attend invocation + worktree note + VERBATIM divergence", () => {
  const p = buildAttendPrompt("SP-1_SL-2", "AC #5: $ tsc → exit 127", "/wt/TEP-1_SP-4");
  assert.match(p, /^\/attend SP-1_SL-2/);
  // The worktree the fix lands in — the session itself opens in the canonical repo.
  assert.match(p, /worktree.*\/wt\/TEP-1_SP-4/);
  assert.match(p, /commit it to the spec branch/);
  // Evidence passes VERBATIM (2026-07-11): ordinal, command, exit code all visible.
  assert.match(p, /AC #5: \$ tsc → exit 127/);
  // No divergence → bare invocation (+ optional worktree note only).
  assert.equal(buildAttendPrompt("SP-1_SL-2"), "/attend SP-1_SL-2");
});

// ── 2026-07-11: rework feedback is VERBATIM ────────────────────────────────
//
// The SP-6 AC3 anti-gaming scrubber (stripFailingCheck) was REMOVED: it blinded
// the fixer to exactly the fault classes it most needed to see (an unrunnable
// probe, a phantom footprint path), while grading independence was already
// enforced where it belongs — the assessor/judge are never the fixer. These
// tests pin the new contract: the prompts carry the evidence as-is.

test("attend/reject prompts carry failing evidence VERBATIM (no scrubbing)", () => {
  const raw =
    "The exporter emits ISO-8601 timestamps, but the intent is Unix epoch seconds.\n" +
    "AC #3 failed.\n$ npm test -- export.spec.ts → exit 1";
  const attend = buildAttendPrompt("SP-6_SL-3", raw, "/wt/x");
  const reject = buildRejectPrompt("6", raw, undefined, "/wt/x");
  for (const p of [attend, reject]) {
    assert.match(p, /Unix epoch seconds/);
    assert.match(p, /AC #3 failed/);
    assert.match(p, /npm test -- export\.spec\.ts/);
    assert.match(p, /exit 1/);
    assert.match(p, /\/wt\/x/);
  }
});

test("buildRejectPrompt: bare invocation without divergence; worktree note when supplied", () => {
  assert.equal(buildRejectPrompt("6"), "/attend SP-6");
  assert.match(
    buildRejectPrompt("6", undefined, undefined, "/wt/y"),
    /worktree.*\/wt\/y/,
  );
});

test("batchExecutionUnits: ALL code units collapse to ONE coder; test units keep per-AC fan-out", () => {
  // Tests-first (2026-07-08): the slice is the unit of code scheduling — serial,
  // mechanize and fan-out code units alike become one execution unit (one coder per
  // slice), while role:test units keep their per-AC granularity.
  const units: WorkUnit[] = [
    { footprint: ["a"], execution: "serial" },
    { footprint: ["b"], execution: "serial" },
    { footprint: ["c"], execution: "mechanize" },
    { footprint: ["d"], execution: "fan-out" },
    { footprint: ["e"], execution: "fan-out" },
    { footprint: ["t1"], execution: "fan-out", role: "test" },
    { footprint: ["t2"], execution: "fan-out", role: "test" },
  ];
  const eu = batchExecutionUnits(units);
  assert.equal(eu.length, 3); // 1 collapsed coder + 2 test fan-outs
  assert.equal(eu[0].shape, "serial");
  assert.equal(eu[0].units.length, 5); // every code unit, in authored order
  assert.ok(eu[0].units.every((u) => (u.role ?? "code") !== "test"));
  const testEus = eu.filter((e) => e.units.some((u) => u.role === "test"));
  assert.equal(testEus.length, 2);
  assert.ok(testEus.every((e) => e.units.length === 1 && e.shape === "fan-out"));
});

// ── buildUnitDag + readyFrontier (SP-tgs8nz makespan scheduler) ────────────

// `requires` is intentionally omitted: SP-5/1 retired the authored slice-level
// `depends_on` — `buildUnitDag` sources every edge from `consumes`+footprint, so a
// slice's dependencies are now expressed by a unit's `consumes`, never a slice handle.
const slice = (handle: string, o: Partial<SliceForDag> = {}): SliceForDag => ({
  handle,
  status: o.status ?? "ready",
  files: o.files ?? [],
  workUnits: o.workUnits ?? [],
});

test("buildUnitDag: a unit-less slice becomes ONE serial node (legacy)", () => {
  const dag = buildUnitDag([slice("SP-1_SL-1", { files: ["a.ts", "b.ts"] })]);
  assert.equal(dag.length, 1);
  assert.equal(dag[0].id, "SP-1_SL-1");
  assert.equal(dag[0].slice, "SP-1_SL-1");
  assert.equal(dag[0].shape, "serial");
  assert.deepEqual(dag[0].footprint, ["a.ts", "b.ts"]);
});

test("buildUnitDag: a slice's code units collapse into ONE coder node (union footprint, notes in order); test units split per-AC and gate the coder", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [
        { footprint: ["a.ts"], execution: "serial" },
        { footprint: ["b.ts"], execution: "serial" },
        { footprint: ["c.ts"], execution: "fan-out", note: "do c" },
        { footprint: ["d.ts"], execution: "fan-out", note: "do d" },
        { footprint: ["t1.test.ts"], execution: "fan-out", role: "test", note: "assert AC1" },
        { footprint: ["t2.test.ts"], execution: "fan-out", role: "test", note: "assert AC2" },
      ],
    }),
  ]);
  // 1 collapsed coder + 2 per-AC test nodes = 3
  assert.equal(dag.length, 3);
  const coder = dag.find((u) => u.role !== "test")!;
  assert.deepEqual(coder.footprint.slice().sort(), [
    "a.ts",
    "b.ts",
    "c.ts",
    "d.ts",
  ]);
  assert.equal(coder.note, "do c; do d");
  const tests = dag.filter((u) => u.role === "test");
  assert.equal(tests.length, 2);
  // Tests-first: the coder waits on every same-slice test unit.
  assert.deepEqual(
    coder.requires.slice().sort(),
    tests.map((t) => t.id).sort(),
  );
  // Test units have no implicit edge back (they dispatch first).
  for (const t of tests) assert.deepEqual(t.requires, []);
});

test("buildUnitDag: units from multiple slices pool into one DAG; a `consumes` edge crosses the slice boundary", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }],
    }),
    slice("SP-1_SL-2", {
      workUnits: [
        { footprint: ["b.ts"], execution: "fan-out", consumes: ["a.ts"] },
        { footprint: ["c.ts"], execution: "fan-out", consumes: ["a.ts"] },
      ],
    }),
  ]);
  // one coder node per slice (SL-2's two code units collapse) — pooled across slices
  assert.equal(dag.length, 2);
  // SL-2's coder reads a.ts → depends on its (cross-slice) producer, by edge not by inheritance
  const sl2 = dag.find((u) => u.slice === "SP-1_SL-2")!;
  assert.deepEqual(sl2.footprint.slice().sort(), ["b.ts", "c.ts"]);
  assert.deepEqual(sl2.requires, ["SP-1_SL-1#eu-0"]);
});

test("buildUnitDag: a cross-slice `consumes` resolves to the EXACT producing node, not all-to-all (AC1)", () => {
  // Producers live in two different slices (intra-slice code units now collapse into one
  // coder, so the exact-producer invariant is pinned across slices — where it matters).
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }], // produces a.ts
    }),
    slice("SP-1_SL-2", {
      workUnits: [{ footprint: ["b.ts"], execution: "fan-out" }], // produces b.ts
    }),
    slice("SP-1_SL-3", {
      workUnits: [
        { footprint: ["c.ts"], execution: "fan-out", consumes: ["a.ts"] },
      ],
    }),
  ]);
  const sl3 = dag.find((u) => u.slice === "SP-1_SL-3")!;
  // lands on the producer of a.ts ONLY — NOT b.ts's producer, NOT a coarse all-to-all fan-in
  assert.deepEqual(sl3.requires, ["SP-1_SL-1#eu-0"]);
  // and the pooled DAG validates — the edge is a real, resolvable node id
  const verdict = validateDag(
    dag.map((u) => ({ id: u.id, requires: u.requires })),
  );
  assert.equal(verdict.ok, true);
});

test("buildUnitDag: a file produced by TWO units makes a consumer depend on BOTH (AC2)", () => {
  // Two writers of the same file in two different slices (intra-slice writers collapse
  // into one coder, so multi-writer fan-in is a cross-slice phenomenon now).
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [{ footprint: ["shared.ts"], execution: "fan-out" }], // producer 1
    }),
    slice("SP-1_SL-2", {
      workUnits: [{ footprint: ["shared.ts", "x.ts"], execution: "fan-out" }], // producer 2
    }),
    slice("SP-1_SL-3", {
      workUnits: [
        { footprint: ["c.ts"], execution: "fan-out", consumes: ["shared.ts"] },
      ],
    }),
  ]);
  const sl3 = dag.find((u) => u.slice === "SP-1_SL-3")!;
  // shared.ts has two writers → the consumer waits on EVERY writer (reads it fully written)
  assert.deepEqual(sl3.requires.slice().sort(), [
    "SP-1_SL-1#eu-0",
    "SP-1_SL-2#eu-0",
  ]);
});

test("buildUnitDag: a cross-slice unit that consumes nothing upstream has NO edge (AC3)", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [
        { footprint: ["a.ts"], execution: "fan-out" },
        { footprint: ["b.ts"], execution: "fan-out" },
      ],
    }),
    slice("SP-1_SL-2", {
      // consumes nothing SL-1 produces → independent; no slice-level fan-in survives
      workUnits: [{ footprint: ["c.ts"], execution: "fan-out" }],
    }),
  ]);
  const sl2 = dag.find((u) => u.slice === "SP-1_SL-2")!;
  assert.deepEqual(sl2.requires, []);
});

const emptyState = (over: Partial<SchedulerState> = {}): SchedulerState => ({
  done: over.done ?? new Set(),
  running: over.running ?? new Set(),
  blocked: over.blocked ?? new Set(),
});

test("readyFrontier: independent disjoint units are all ready (max parallelism)", () => {
  // Parallelism lives BETWEEN slices now: three file-disjoint slices → three ready coders.
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }],
    }),
    slice("SP-1_SL-2", {
      workUnits: [{ footprint: ["b.ts"], execution: "fan-out" }],
    }),
    slice("SP-1_SL-3", {
      workUnits: [{ footprint: ["c.ts"], execution: "fan-out" }],
    }),
  ]);
  const f = readyFrontier(dag, emptyState());
  assert.equal(f.length, 3);
});

test("readyFrontier: a unit waits until the unit it consumes from is done", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }],
    }),
    slice("SP-1_SL-2", {
      workUnits: [
        { footprint: ["b.ts"], execution: "fan-out", consumes: ["a.ts"] },
      ],
    }),
  ]);
  // SL-1's unit not done → only it is ready
  let f = readyFrontier(dag, emptyState());
  assert.deepEqual(
    f.map((u) => u.id),
    ["SP-1_SL-1#eu-0"],
  );
  // mark the producer done → SL-2's consumer becomes ready
  f = readyFrontier(dag, emptyState({ done: new Set(["SP-1_SL-1#eu-0"]) }));
  assert.deepEqual(
    f.map((u) => u.id),
    ["SP-1_SL-2#eu-0"],
  );
});

// ── SP-6/2 AC1: dependency ordering is enforced (load-bearing) ─────────────
// Over a fixture DAG where execution unit B `consumes` a file unit A produces, the
// scheduler never reports B dispatchable until A has landed: B is ABSENT from the ready
// frontier while A is pending (un-dispatched OR in flight), and appears ONLY once A is
// done. Pinned through the NAMED `requiresSatisfied` gate so a refactor can't silently
// weaken the invariant to an inline filter clause.
test("AC1: a consumer is absent from the frontier while its producer is pending, present once it is done", () => {
  // Fixture DAG: B (consumer.ts) consumes producer.ts → a real edge B.requires = [A].
  const dag = buildUnitDag([
    slice("SP-6_SL-1", {
      workUnits: [{ footprint: ["producer.ts"], execution: "fan-out" }],
    }),
    slice("SP-6_SL-2", {
      workUnits: [
        {
          footprint: ["consumer.ts"],
          execution: "fan-out",
          consumes: ["producer.ts"],
        },
      ],
    }),
  ]);
  const producer = "SP-6_SL-1#eu-0";
  const consumer = "SP-6_SL-2#eu-0";
  const b = dag.find((u) => u.id === consumer)!;
  assert.deepEqual(
    b.requires,
    [producer],
    "the `consumes` edge resolves to the producing unit",
  );

  const inFrontier = (state: SchedulerState) =>
    readyFrontier(dag, state).some((u) => u.id === consumer);

  // A PENDING (never dispatched) → B absent from the frontier.
  assert.equal(
    inFrontier(emptyState()),
    false,
    "consumer absent while its producer is pending (un-dispatched)",
  );
  // A still PENDING (in flight, not yet done) → B STILL absent.
  assert.equal(
    inFrontier(emptyState({ running: new Set(["producer.ts"]) })),
    false,
    "consumer absent while its producer is in flight (not yet landed)",
  );
  // A DONE → B finally appears.
  assert.equal(
    inFrontier(emptyState({ done: new Set([producer]) })),
    true,
    "consumer appears in the frontier only once its producer is done",
  );

  // The frontier routes B through the named, load-bearing gate: a pending or unresolved
  // producer is treated as not-done (fail-safe blocks), a done one satisfies it.
  assert.equal(
    requiresSatisfied(b.requires, new Set()),
    false,
    "a pending producer leaves `requires` unsatisfied",
  );
  assert.equal(
    requiresSatisfied(b.requires, new Set(["SP-6_SL-99#eu-0"])),
    false,
    "an unresolved producer (names no done unit) leaves `requires` unsatisfied",
  );
  assert.equal(
    requiresSatisfied(b.requires, new Set([producer])),
    true,
    "the producer being done satisfies `requires`",
  );
});

test("readyFrontier: footprint conflicts serialize (running blocks an overlap)", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [
        { footprint: ["shared.ts"], execution: "fan-out" },
        { footprint: ["shared.ts", "x.ts"], execution: "fan-out" },
        { footprint: ["y.ts"], execution: "fan-out" },
      ],
    }),
  ]);
  // nothing running: the two shared.ts units can't both go; y.ts is independent
  const f = readyFrontier(dag, emptyState());
  const fps = f.flatMap((u) => u.footprint);
  // shared.ts appears at most once in the dispatched batch
  assert.equal(fps.filter((x) => x === "shared.ts").length, 1);
  assert.ok(fps.includes("y.ts"));
});

test("readyFrontier: a running footprint excludes an overlapping unit", () => {
  // Overlap arbitration is inter-slice now (a slice's code side is one coder).
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }],
    }),
    slice("SP-1_SL-2", {
      workUnits: [{ footprint: ["b.ts"], execution: "fan-out" }],
    }),
  ]);
  const f = readyFrontier(dag, emptyState({ running: new Set(["a.ts"]) }));
  assert.deepEqual(
    f.map((u) => u.footprint[0]),
    ["b.ts"],
  );
});

test("readyFrontier: critical-path first — the unit with the longest chain leads", () => {
  // SL-1 (a) → SL-2 (b) → SL-3 (c) chain via `consumes`, plus an independent SL-4 (d).
  // At the start only SL-1 and SL-4 are ready; SL-1 has the longer chain → first.
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }],
    }),
    slice("SP-1_SL-2", {
      workUnits: [
        { footprint: ["b.ts"], execution: "fan-out", consumes: ["a.ts"] },
      ],
    }),
    slice("SP-1_SL-3", {
      workUnits: [
        { footprint: ["c.ts"], execution: "fan-out", consumes: ["b.ts"] },
      ],
    }),
    slice("SP-1_SL-4", {
      workUnits: [{ footprint: ["d.ts"], execution: "fan-out" }],
    }),
  ]);
  const f = readyFrontier(dag, emptyState());
  assert.equal(
    f[0].id,
    "SP-1_SL-1#eu-0",
    "longest-chain unit dispatched first",
  );
});

test("readyFrontier: blocked units (requires-attention slice) are not dispatched", () => {
  const dag = buildUnitDag([slice("SP-1_SL-1", { files: ["a.ts"] })]);
  const f = readyFrontier(dag, emptyState({ blocked: new Set(["SP-1_SL-1"]) }));
  assert.equal(f.length, 0);
});

// ── needs-input + worker prompt ───────────────────────────

test("extractNeedsInput: pulls the question after the sentinel; null when absent", () => {
  assert.equal(
    extractNeedsInput(
      `some log\n${NEEDS_INPUT_SENTINEL} Which database — pg or sqlite?`,
    ),
    "Which database — pg or sqlite?",
  );
  assert.equal(extractNeedsInput("worked fine, done"), null);
  // sentinel with no text still parks (with a placeholder)
  assert.equal(extractNeedsInput(NEEDS_INPUT_SENTINEL), "(no question text)");
});

test("sessionIdOf: reads a string session_id, undefined otherwise", () => {
  assert.equal(
    sessionIdOf({ type: "system", session_id: "abc-123" }),
    "abc-123",
  );
  assert.equal(sessionIdOf({ type: "system" }), undefined);
  assert.equal(sessionIdOf({ session_id: 42 }), undefined);
});

test("buildWorkerPrompt: scopes to the unit + footprint, forbids git, instructs the sentinel", () => {
  const unit: SchedUnit = {
    id: "SP-3_SL-2#eu-0",
    slice: "SP-3_SL-2",
    footprint: ["src/a.ts"],
    requires: [],
    shape: "fan-out",
    note: "add a test for module a",
  };
  const p = buildWorkerPrompt(unit, "3");
  assert.match(p, /SP-3_SL-2#eu-0/);
  assert.match(p, /src\/a\.ts/);
  assert.match(p, /add a test for module a/);
  assert.match(p, /Do NOT commit/);
  assert.ok(
    p.includes(NEEDS_INPUT_SENTINEL),
    "instructs the escalation sentinel",
  );

  // The worktree has no specs dir, so context is embedded in the prompt, not pointed to on disk.
  // SP-6 AC1: the embedded context is the INTENT view — the `## Acceptance Criteria` block is
  // held out, so the worker reads the Design/intent but never the rubric it is graded on.
  const withCtx = buildWorkerPrompt(unit, "3", {
    specBody:
      "## Design\n\nDeploy headlamp into its namespace.\n\n## Acceptance Criteria\n\n- [ ] headlamp deploys",
    sliceBody: "Pinned: namespace headlamp",
  });
  assert.doesNotMatch(withCtx, /Acceptance Criteria/);
  assert.match(withCtx, /Deploy headlamp into its namespace/);
  assert.match(withCtx, /Pinned: namespace headlamp/);
  assert.match(withCtx, /NOT in this worktree/);
});

// ── SP-6 AC1: hold out the exam — intent in, gradeable criteria withheld ────
// The worker prompt must carry the INTENT (summary / Design / the unit's task + footprint)
// but NEVER the Spec's `## Acceptance Criteria` block nor the slice's `satisfies` ordinals —
// the implementer cannot read the rubric it is graded on, so a green proves intent, not
// "I optimised to the assertions I was shown."

test("AC1: buildWorkerPrompt embeds the intent view but withholds the Acceptance Criteria block + satisfies", () => {
  const unit: SchedUnit = {
    id: "SP-6_SL-1#eu-0",
    slice: "SP-6_SL-1",
    footprint: ["src/foo.ts"],
    requires: [],
    shape: "fan-out",
    note: "implement foo end to end",
  };
  const specBody = [
    "# The Spec title",
    "",
    "A one-line summary of what correct behaviour looks like.",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] **a secret gradeable rubric** the worker must never read",
    "- [ ] another hidden criterion the implementer is graded on",
    "",
    "## Design",
    "",
    "Build foo by wiring the bar seam onto the baz core.",
    "",
    "## Constraints",
    "",
    "Reuse, don't fork the existing seam.",
  ].join("\n");
  const sliceBody = [
    "---",
    "status: ready",
    "satisfies: [2, 4]",
    "---",
    "",
    "# Slice intent",
    "",
    "Wire foo end to end so the bar seam reaches the baz core.",
  ].join("\n");

  const p = buildWorkerPrompt(unit, "6", { specBody, sliceBody });

  // The INTENT view is present — summary, Design, Constraints, and the slice's intent prose.
  assert.match(p, /one-line summary of what correct behaviour looks like/);
  assert.match(p, /Build foo by wiring the bar seam onto the baz core/);
  assert.match(p, /Reuse, don't fork the existing seam/); // block boundary stopped at ## Constraints
  assert.match(p, /Wire foo end to end so the bar seam reaches the baz core/);
  // …and the unit's own task/footprint (the rest of the intent view).
  assert.match(p, /SP-6_SL-1#eu-0/);
  assert.match(p, /src\/foo\.ts/);
  assert.match(p, /implement foo end to end/);

  // The gradeable criteria are HELD OUT — neither the heading nor any of its body lines leak.
  assert.doesNotMatch(p, /Acceptance Criteria/);
  assert.doesNotMatch(p, /a secret gradeable rubric/);
  assert.doesNotMatch(p, /another hidden criterion/);

  // The `satisfies` ordinals are withheld — the worker can't learn which ACs it is graded against.
  assert.doesNotMatch(p, /satisfies/i);
  assert.doesNotMatch(p, /\[2, 4\]/);
});

test("AC1: buildWorkerPrompt withholds the AC block even when it is the LAST section (no trailing heading)", () => {
  const unit: SchedUnit = {
    id: "SP-6_SL-2#eu-0",
    slice: "SP-6_SL-2",
    footprint: ["src/bar.ts"],
    requires: [],
    shape: "fan-out",
  };
  const specBody = [
    "## Design",
    "",
    "Intent: make bar idempotent.",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] bar is idempotent under retry",
    "- [ ] bar never double-writes",
  ].join("\n");

  const p = buildWorkerPrompt(unit, "6", { specBody });
  assert.match(p, /make bar idempotent/); // intent survives
  assert.doesNotMatch(p, /Acceptance Criteria/); // trailing AC block fully removed
  assert.doesNotMatch(p, /idempotent under retry/);
  assert.doesNotMatch(p, /never double-writes/);
});

// ── SP-12: code-author self-verify command + standing prohibitions ─────────────
// A CODE unit's prompt carries (1) a VERIFICATION BLOCK with the repo's declared self-verify
// command verbatim under a grep-checkable `SELF-VERIFY` marker — but ONLY when a command is
// supplied — and (2)/(3) two UNCONDITIONAL prohibitions: never edit outside the footprint (shared
// build/config, `tsconfig*.json` included) and never build/run the held-out `acceptance/` probes
// (the closing gate grades them). A `test` unit renders NONE of these.

test("SP-12: buildWorkerPrompt renders the SELF-VERIFY block verbatim + both prohibitions for a code unit", () => {
  const unit: SchedUnit = {
    id: "SP-12_SL-1#eu-0",
    slice: "SP-12_SL-1",
    footprint: ["src/foo.ts"],
    requires: [],
    shape: "serial",
    role: "code",
  };
  const cmd = "npx tsc -p tsconfig.test.json && node --test out-test/";
  const p = buildWorkerPrompt(unit, "12", { selfVerifyCommand: cmd });

  // (1) VERIFICATION BLOCK — the `SELF-VERIFY` marker + the command VERBATIM.
  assert.match(p, /SELF-VERIFY/);
  assert.ok(p.includes(cmd), "renders the self-verify command verbatim");

  // (2) FOOTPRINT PROHIBITION — contains `footprint` AND `tsconfig`.
  assert.match(p, /footprint/);
  assert.match(p, /tsconfig/);

  // (3) HELD-OUT PROHIBITION — contains `acceptance/`, `closing gate`, and `do not build or run`.
  assert.match(p, /acceptance\//);
  assert.match(p, /closing gate/);
  assert.match(p, /do not build or run/);
});

test("SP-12: buildWorkerPrompt trims the self-verify command and renders it once, trimmed", () => {
  const unit: SchedUnit = {
    id: "SP-12_SL-1#eu-1",
    slice: "SP-12_SL-1",
    footprint: ["src/foo.ts"],
    requires: [],
    shape: "serial",
  };
  const p = buildWorkerPrompt(unit, "12", {
    selfVerifyCommand: "   npm run verify   ",
  });
  assert.match(p, /SELF-VERIFY/);
  assert.ok(p.includes("npm run verify"), "renders the trimmed command");
  assert.doesNotMatch(p, /SELF-VERIFY[\s\S]*\S   npm/); // no leading padding preserved
});

test("SP-12: buildWorkerPrompt omits the SELF-VERIFY block + marker when no command is declared, prohibitions still render", () => {
  const unit: SchedUnit = {
    id: "SP-12_SL-1#eu-2",
    slice: "SP-12_SL-1",
    footprint: ["src/foo.ts"],
    requires: [],
    shape: "serial",
    role: "code",
  };
  // undeclared entirely
  const p = buildWorkerPrompt(unit, "12");
  assert.doesNotMatch(p, /SELF-VERIFY/); // marker omitted entirely
  // prohibitions still render unconditionally
  assert.match(p, /tsconfig/);
  assert.match(p, /acceptance\//);
  assert.match(p, /closing gate/);
  assert.match(p, /do not build or run/);

  // a blank/whitespace command is treated as absent too
  const blank = buildWorkerPrompt(unit, "12", { selfVerifyCommand: "   " });
  assert.doesNotMatch(blank, /SELF-VERIFY/);
  assert.match(blank, /do not build or run/);
});

test("SP-12: buildWorkerPrompt renders NONE of the SP-12 blocks for a test unit", () => {
  const unit: SchedUnit = {
    id: "SP-12_SL-1#eu-3",
    slice: "SP-12_SL-1",
    footprint: ["src/acceptance/SP-12_AC-1.test.ts"],
    requires: [],
    shape: "serial",
    role: "test",
  };
  // Even when a command is supplied, a held-out test unit renders no SP-12 block.
  const p = buildWorkerPrompt(unit, "12", {
    selfVerifyCommand: "npx tsc -p tsconfig.test.json && node --test out-test/",
  });
  assert.doesNotMatch(p, /SELF-VERIFY/);
  assert.doesNotMatch(p, /STANDING PROHIBITIONS/);
  assert.doesNotMatch(p, /closing gate/);
  assert.doesNotMatch(p, /do not build or run/);
});

test("stripAcceptanceCriteria: removes the AC heading + its body up to the next same/higher heading; idempotent", () => {
  const body = [
    "# Title",
    "",
    "intent summary",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] hidden one",
    "",
    "### a sub-heading still inside the AC block",
    "",
    "- [ ] hidden two",
    "",
    "## Design",
    "",
    "kept design",
  ].join("\n");
  const stripped = stripAcceptanceCriteria(body);
  assert.doesNotMatch(stripped, /Acceptance Criteria/);
  assert.doesNotMatch(stripped, /hidden one/);
  assert.doesNotMatch(stripped, /sub-heading still inside/);
  assert.doesNotMatch(stripped, /hidden two/);
  assert.match(stripped, /intent summary/);
  assert.match(stripped, /## Design/);
  assert.match(stripped, /kept design/);
  // idempotent: a body with no AC block is unchanged.
  assert.equal(stripAcceptanceCriteria(stripped), stripped);
  assert.equal(stripAcceptanceCriteria("no headings here"), "no headings here");
});

test("stripSatisfies: drops the structured `satisfies:` key (inline + block-list), never prose", () => {
  // inline list form
  assert.doesNotMatch(
    stripSatisfies("satisfies: [1, 3]\nstatus: ready"),
    /satisfies/,
  );
  assert.match(
    stripSatisfies("satisfies: [1, 3]\nstatus: ready"),
    /status: ready/,
  );
  // block-list form — the deeper `- N` items go too
  const block = ["satisfies:", "  - 1", "  - 2", "files:", "  - a.ts"].join(
    "\n",
  );
  const out = stripSatisfies(block);
  assert.doesNotMatch(out, /satisfies/);
  assert.match(out, /files:/);
  assert.match(out, /- a\.ts/);
  // a prose mention of the word is never touched
  assert.match(
    stripSatisfies("This design satisfies the durability goal."),
    /satisfies the durability goal/,
  );
});

// ── Closing AI-verification gate ───────────────────

test("parseAcVerifications: normalizes the frontmatter map → ordered AcVerification[]", () => {
  const v = parseAcVerifications({
    "2": { run: "helm test", env: "cluster" },
    "1": { run: " npm test ", env: "local" },
  });
  assert.deepEqual(v, [
    { ac: 1, run: "npm test", env: "local" },
    { ac: 2, run: "helm test", env: "cluster" },
  ]);
});

test("parseAcVerifications: drops invalid entries (no run, bad ordinal, bad env), tolerates missing", () => {
  assert.deepEqual(parseAcVerifications(undefined), []);
  assert.deepEqual(parseAcVerifications({}), []);
  const v = parseAcVerifications({
    "0": { run: "x" }, // non-positive ordinal
    foo: { run: "x" }, // non-numeric key
    "1": { run: "" }, // empty run
    "2": { run: "ok", env: "weird" }, // bad env → dropped to undefined
    "3": { nope: true }, // no run field
  });
  assert.deepEqual(v, [{ ac: 2, run: "ok", env: undefined }]);
});

test("runAcVerifications: exit 0 = pass, non-zero = fail, attributed per-AC, in order", async () => {
  const ran: string[] = [];
  const exec: AcExec = async (run) => {
    ran.push(run);
    return { code: run.includes("FAIL") ? 1 : 0, output: `out:${run}` };
  };
  const results = await runAcVerifications(
    [
      { ac: 1, run: "step-install" },
      { ac: 2, run: "step-FAIL" },
      { ac: 3, run: "step-rollback" },
    ],
    "/wt",
    exec,
  );
  assert.deepEqual(ran, ["step-install", "step-FAIL", "step-rollback"]);
  assert.deepEqual(
    results.map((r) => [r.ac, r.pass]),
    [
      [1, true],
      [2, false],
      [3, true],
    ],
  );
  assert.match(results[0].evidence, /exit 0/);
  assert.match(results[1].evidence, /exit 1/);
});

test("runAcVerifications: a FAILING check's evidence carries the failing assertion, not just the summary counts", async () => {
  // The evidence feeds the rework round's worker prompt and the human's DELIVERY read —
  // "# fail 1" alone forces log archaeology (the SP-6/3 round-2 diagnosis). The node:test
  // TAP failure block (`not ok` + its YAML diagnostic) must survive into the evidence.
  const tap = [
    "TAP version 13",
    "not ok 2 - a content-bound approval clears the gate after an edit",
    "  ---",
    "  failureType: 'testCodeFailure'",
    "  error: 'SP-1/1 AC 2 has no runnable ac_verifications entry'",
    "  ...",
    "1..2",
    "# tests 2",
    "# pass 1",
    "# fail 1",
  ].join("\n");
  const exec: AcExec = async () => ({ code: 1, output: tap });
  const [r] = await runAcVerifications(
    [{ ac: 4, run: "probe-4" }],
    "/wt",
    exec,
  );
  assert.equal(r.pass, false);
  assert.match(r.evidence, /not ok 2 - a content-bound approval/);
  assert.match(r.evidence, /no runnable ac_verifications entry/);
  assert.match(r.evidence, /# fail 1/);
  // A PASSING check keeps the lean tail-only shape (no failure-block extraction) — with a
  // realistic long output, the head of the run never appears, only the trailing summary.
  const longOk = [
    "TAP version 13",
    ...Array.from({ length: 30 }, (_, i) => `ok ${i + 1} - case ${i + 1}`),
    "1..30",
    "# tests 30",
    "# pass 30",
    "# fail 0",
  ].join("\n");
  const ok: AcExec = async () => ({ code: 0, output: longOk });
  const [g] = await runAcVerifications([{ ac: 1, run: "probe-1" }], "/wt", ok);
  assert.match(g.evidence, /# pass 30/);
  assert.doesNotMatch(g.evidence, /ok 1 - case 1\b/);
});

test("runAcVerifications: an un-runnable check is RED, never silently green (no skip)", async () => {
  const exec: AcExec = async () => {
    throw new Error("command not found");
  };
  const [r] = await runAcVerifications(
    [{ ac: 1, run: "missing-cmd" }],
    "/wt",
    exec,
  );
  assert.equal(r.pass, false);
  assert.match(r.evidence, /could not run: command not found/);
});

test("checkAcOrdinals: ticks only the named ordinals under Acceptance Criteria", () => {
  const body = [
    "# Spec",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] first AC",
    "- [ ] second AC",
    "- [ ] third AC",
    "",
    "## Design",
    "",
    "- [ ] not an AC (different section)",
  ].join("\n");
  const out = checkAcOrdinals(body, [1, 3]);
  const lines = out.split("\n");
  assert.equal(lines[4], "- [x] first AC");
  assert.equal(lines[5], "- [ ] second AC");
  assert.equal(lines[6], "- [x] third AC");
  // a checkbox outside the AC section is never touched
  assert.equal(lines[10], "- [ ] not an AC (different section)");
});

test("checkAcOrdinals: out-of-range / already-checked are no-ops; empty input unchanged", () => {
  const body = "## Acceptance Criteria\n\n- [x] done\n- [ ] todo\n";
  assert.equal(checkAcOrdinals(body, []), body);
  // #1 already checked, #9 out of range → body unchanged
  assert.equal(checkAcOrdinals(body, [1, 9]), body);
  assert.match(checkAcOrdinals(body, [2]), /- \[x\] todo/);
});

test("buildDeliveryReport: carries the per-AC pass/fail table + evidence (auditable)", () => {
  const acResults: AcResult[] = [
    { ac: 1, pass: true, evidence: "$ install → exit 0" },
    { ac: 2, pass: false, evidence: "$ test → exit 1\nassertion failed" },
  ];
  const md = buildDeliveryReport({
    specNumber: "tgzyfy",
    sha: "abc1234",
    files: ["src/a.ts"],
    units: [{ id: "SP-tgzyfy_SL-1#eu-0", outcome: "success" }],
    declared: [
      { ac: 1, run: "install", env: "cluster" },
      { ac: 2, run: "test", env: "cluster" },
    ],
    acResults,
    problems: ["worker X hit a wall"],
    advanced: ["SP-tgzyfy_SL-1"],
    attention: [],
    committed: true,
  });
  assert.match(md, /## Acceptance criteria/);
  assert.match(md, /#1 \|.*✓ pass/); // ordinal-only table form (no acTexts supplied)
  assert.match(md, /#2 \|.*✗ fail/);
  assert.match(md, /assertion failed/); // evidence excerpt present (in the appendix)
  assert.match(md, /Caught problems/);
  assert.match(md, /worker X hit a wall/);
  assert.match(md, /abc1234/);
});

test("buildDeliveryReport: no declared verifications → the no-skip warning, not a silent pass", () => {
  const md = buildDeliveryReport({
    specNumber: "1",
    sha: "",
    files: [],
    units: [],
    declared: [],
    acResults: [],
    advanced: [],
    committed: false,
  });
  assert.match(md, /No `ac_verifications` declared/);
  assert.match(md, /requires-attention/);
  assert.match(md, /not committed/);
});

// ── SP-11/3: human-first delivery report — What happened / criterion text / discoveries / appendix ──

test("SP-11/3: buildDeliveryReport section order — What happened → Acceptance criteria → Discoveries → Files → Next → Evidence appendix", () => {
  const md = buildDeliveryReport({
    specNumber: "11/3",
    sha: "abc1234",
    files: ["src/a.ts"],
    units: [{ id: "SP-11_SP-3_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "probe", env: "local" }],
    acResults: [{ ac: 1, pass: true, evidence: "$ probe → exit 0" }],
    advanced: ["SP-11_SP-3_SL-1"],
    committed: true,
  });
  const order = [
    "# Delivery — TEP-11_SP-3",
    "## What happened",
    "## Acceptance criteria",
    "## Discoveries & recommendations",
    "## Files",
    "## Next",
    "## Evidence appendix",
  ].map((h) => md.indexOf(h));
  order.forEach((idx, k) =>
    assert.ok(idx !== -1, `heading ${k} present in the report`),
  );
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepEqual(order, sorted, "headings appear in the contract's order");
});

test("SP-11/3: on failure What happened renders the judge's diagnosis VERBATIM and UNCLIPPED", () => {
  // A long, specific diagnosis — the report must carry it whole (no trace-table clip), as flowing prose.
  const longText =
    "The reload path never re-emits: buildAttendPrompt is called with the slice-body diagnosis, but on an attended session the store's subscription is torn down before the replayed event lands, so the panel shows a stale token indefinitely — this is the exact mechanism SP-11/2 lost when the diagnosis was clipped to 160 chars for the trace table.";
  const md = buildDeliveryReport({
    specNumber: "11/3",
    sha: "",
    files: ["src/a.ts"],
    units: [{ id: "u#eu-0", outcome: "failed" }],
    declared: [{ ac: 2, run: "probe", env: "local" }],
    acResults: [{ ac: 2, pass: false, evidence: "$ probe → exit 1" }],
    diagnosis: [{ ac: 2, text: longText }],
    advanced: [],
    committed: false,
  });
  // The full text is present under What happened, before the Acceptance-criteria heading.
  const whStart = md.indexOf("## What happened");
  const acStart = md.indexOf("## Acceptance criteria");
  assert.ok(md.includes(longText), "diagnosis rendered verbatim, unclipped");
  const whIdx = md.indexOf(longText);
  assert.ok(
    whIdx > whStart && whIdx < acStart,
    "the diagnosis sits inside the What-happened section",
  );
});

test("SP-11/3: multiple diagnosis texts join as prose, each verbatim", () => {
  const md = buildDeliveryReport({
    specNumber: "11/3",
    sha: "",
    files: [],
    units: [],
    declared: [
      { ac: 1, run: "p1", env: "local" },
      { ac: 3, run: "p3", env: "local" },
    ],
    acResults: [
      { ac: 1, pass: false, evidence: "e1" },
      { ac: 3, pass: false, evidence: "e3" },
    ],
    diagnosis: [
      { ac: 1, text: "First: the guard rejects a valid path." },
      { ac: 3, text: "Third: the token never reaches the re-author." },
    ],
    advanced: [],
    committed: false,
  });
  assert.match(md, /First: the guard rejects a valid path\./);
  assert.match(md, /Third: the token never reaches the re-author\./);
});

test("SP-11/3: Acceptance criteria rows carry the criterion TEXT + verdict when acTexts is supplied (ordinal token kept)", () => {
  const md = buildDeliveryReport({
    specNumber: "11/3",
    sha: "abc",
    files: [],
    units: [],
    declared: [
      { ac: 1, run: "p1", env: "local" },
      { ac: 2, run: "p2", env: "local" },
      { ac: 3, run: "p3", env: "local" },
    ],
    acResults: [
      { ac: 1, pass: true, evidence: "ok" },
      { ac: 2, pass: false, evidence: "bad" },
      // AC3 not run
    ],
    acTexts: [
      "The report opens with What happened",
      "AC rows carry the criterion text",
      "Discoveries surface out-of-scope findings",
    ],
    advanced: [],
    committed: false,
  });
  assert.match(md, /#1 — The report opens with What happened — ✓ pass/);
  assert.match(md, /#2 — AC rows carry the criterion text — ✗ fail/);
  assert.match(
    md,
    /#3 — Discoveries surface out-of-scope findings — · not run/,
  );
  // The criterion-text form replaces the ordinal table (no `| Verified by |` header).
  assert.doesNotMatch(md, /\| Verified by \|/);
});

test("SP-11/3: Discoveries renders BOTH unit and text; empty/omitted → 'none reported'", () => {
  const withDisc = buildDeliveryReport({
    specNumber: "11/3",
    sha: "abc",
    files: [],
    units: [],
    declared: [{ ac: 1, run: "p", env: "local" }],
    acResults: [{ ac: 1, pass: true, evidence: "ok" }],
    discoveries: [
      {
        unit: "SP-11_SP-3_SL-1#eu-0",
        text: "the settings merge drops unknown keys",
      },
    ],
    advanced: ["SP-11_SP-3_SL-1"],
    committed: true,
  });
  assert.match(withDisc, /## Discoveries & recommendations/);
  assert.match(withDisc, /SP-11_SP-3_SL-1#eu-0/); // the unit id
  assert.match(withDisc, /the settings merge drops unknown keys/); // the text
  assert.doesNotMatch(withDisc, /none reported/);

  const withoutDisc = buildDeliveryReport({
    specNumber: "11/3",
    sha: "abc",
    files: [],
    units: [],
    declared: [{ ac: 1, run: "p", env: "local" }],
    acResults: [{ ac: 1, pass: true, evidence: "ok" }],
    advanced: [],
    committed: true,
  });
  const discIdx = withoutDisc.indexOf("## Discoveries & recommendations");
  const filesIdx = withoutDisc.indexOf("## Files");
  assert.ok(
    withoutDisc.slice(discIdx, filesIdx).includes("none reported"),
    "empty discoveries render the literal fallback",
  );
});

test("SP-11/3: the per-AC fenced evidence blocks and the trace table live ONLY under the Evidence appendix", () => {
  const md = buildDeliveryReport({
    specNumber: "11/3",
    sha: "abc",
    files: ["src/a.ts"],
    units: [{ id: "u#eu-0", outcome: "failed" }],
    declared: [{ ac: 1, run: "probe.js", env: "local" }],
    acResults: [
      {
        ac: 1,
        pass: false,
        evidence: "$ probe.js → exit 1\nboom the assertion blew up",
      },
    ],
    diagnosis: [
      { ac: 1, text: "the probe expects state the contract never guarantees" },
    ],
    acTexts: ["The probe grades the real behaviour"],
    advanced: [],
    committed: false,
    trace: [
      {
        ac: 1,
        round: 1,
        kind: "probe",
        verdict: "fail",
        rationale: "never green",
        route: "test",
      },
    ],
  });
  const appendixIdx = md.indexOf("## Evidence appendix");
  assert.ok(appendixIdx !== -1);
  // Raw evidence (the fenced block) appears, and only after the appendix heading.
  assert.ok(md.indexOf("boom the assertion blew up") > appendixIdx);
  // The verification trace table is demoted under the appendix too.
  const traceIdx = md.indexOf("Verification trace");
  assert.ok(traceIdx > appendixIdx, "trace table sits inside the appendix");
  // The human sections above carry NO fenced runner output.
  assert.ok(
    !md.slice(0, appendixIdx).includes("```"),
    "no fenced evidence before the appendix",
  );
});

// ── SP-11/2: state-derived exit set + exits-driven `## Next` section ─────────
// The exit set is derived from the run's terminal state — delivered vs stalled — never glued
// on fixed: a delivered run offers accept / request-changes, a stalled run attend / rerun. One
// model feeds both the report's `## Next` and the graph's buttons.

test("deliveryExitState: delivered ⇔ committed && gatePassed → [accept, request-changes]", () => {
  const d = deliveryExitState({ committed: true, gatePassed: true });
  assert.equal(d.state, "delivered");
  assert.deepEqual(d.exits, [
    { id: "accept", label: "Accept & merge" },
    { id: "request-changes", label: "Request changes" },
  ]);
});

test("deliveryExitState: anything short of delivered is stalled → [attend, rerun]", () => {
  const stalledExits: ExitAction[] = [
    { id: "attend", label: "Attend" },
    { id: "rerun", label: "Re-run" },
  ];
  for (const run of [
    { committed: false, gatePassed: false },
    { committed: true, gatePassed: false },
    { committed: false, gatePassed: true },
  ]) {
    const s = deliveryExitState(run);
    assert.equal(s.state, "stalled", JSON.stringify(run));
    assert.deepEqual(s.exits, stalledExits, JSON.stringify(run));
  }
  // The retired "Reject" vocabulary never appears in a stalled exit label.
  assert.doesNotMatch(
    deliveryExitState({ committed: false, gatePassed: false })
      .exits.map((e) => e.label)
      .join(" "),
    /reject/i,
  );
});

test("buildDeliveryReport: renders `## Next` as numbered bold-label lines from the exits", () => {
  const md = buildDeliveryReport({
    specNumber: "11/2",
    sha: "abc1234",
    files: ["src/a.ts"],
    units: [{ id: "SP-11_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "test", env: "cluster" }],
    acResults: [{ ac: 1, pass: true, evidence: "$ test → exit 0" }],
    advanced: ["SP-11_SL-1"],
    committed: true,
    exits: deliveryExitState({ committed: true, gatePassed: true }).exits,
  });
  // The `## Next` items are numbered bold-label lines from the delivered exit set.
  assert.match(md, /## Next/);
  assert.match(md, /^1\. \*\*Accept & merge\*\* — /m);
  assert.match(md, /^2\. \*\*Request changes\*\* — /m);
  // "Reject" is retired from the surface — the delivered Next never labels an exit Reject.
  const nextBlock = md.slice(md.indexOf("## Next"));
  assert.doesNotMatch(nextBlock, /\bReject\b/);
});

test("buildDeliveryReport: a stalled exit set renders attend / rerun in `## Next`", () => {
  const md = buildDeliveryReport({
    specNumber: "11/2",
    sha: "",
    files: [],
    units: [],
    declared: [],
    acResults: [],
    advanced: [],
    committed: false,
    exits: deliveryExitState({ committed: false, gatePassed: false }).exits,
  });
  assert.match(md, /^1\. \*\*Attend\*\* — /m);
  assert.match(md, /^2\. \*\*Re-run\*\* — /m);
});

test("buildDeliveryReport: exits omitted → the hard-coded Next text remains (backward compatible)", () => {
  const md = buildDeliveryReport({
    specNumber: "1",
    sha: "abc1234",
    files: ["src/a.ts"],
    units: [{ id: "SP-1_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "test", env: "cluster" }],
    acResults: [{ ac: 1, pass: true, evidence: "$ test → exit 0" }],
    advanced: ["SP-1_SL-1"],
    committed: true,
    // exits omitted
  });
  assert.match(md, /## Next/);
  // The pre-SP-11/2 hard-coded committed text is unchanged when no exit set is supplied.
  assert.match(md, /Review the `spec\/TEP-1` branch/);
});

// ── SP-6/6 AC5: bounded rework loop → escalation, NOT re-queue forever ──────
// After a bounded number of failed rework attempts on the SAME slice the orchestrator must
// STOP re-dispatching and escalate: the verdict flips to `escalate`, the slice carries the
// durable ESCALATION_MARKER, and readyFrontier drops every unit it owns — so a human must
// intervene rather than the loop re-queuing it toward green indefinitely. The bound + the
// verdict are pure / deterministic (no LLM).

test("AC5: reDispatchDecision re-dispatches below the bound and escalates AT the bound (default = MAX_REWORK_ATTEMPTS)", () => {
  // Walk the loop from a fresh slice (0 prior attempts) at the default bound of 3. Each red
  // acceptance run bumps the counter; the verdict stays `re-dispatch` until the count reaches
  // the bound, then flips to `escalate` exactly once — never re-queued past that.
  assert.equal(MAX_REWORK_ATTEMPTS, 3, "default bound is the documented value");
  const seq: ReDispatchVerdict[] = [
    reDispatchDecision(0), // 1st failure → attempts 1, below bound
    reDispatchDecision(1), // 2nd failure → attempts 2, below bound
    reDispatchDecision(2), // 3rd failure → attempts 3, AT the bound → escalate
  ];
  assert.deepEqual(
    seq.map((v) => v.action),
    ["re-dispatch", "re-dispatch", "escalate"],
    "re-dispatch while below the bound, escalate once it is reached — not indefinitely",
  );
  assert.deepEqual(
    seq.map((v) => v.attempts),
    [1, 2, 3],
    "each verdict carries the incremented (prior + 1) attempt count to persist",
  );
  // Past the bound it stays escalated (never silently re-opens).
  assert.equal(reDispatchDecision(3).action, "escalate");
  assert.equal(reDispatchDecision(99).action, "escalate");
});

test("AC5: reDispatchDecision honours a custom bound and is fail-safe on junk priors", () => {
  // A tighter bound of 1: the very first failure escalates.
  assert.equal(reDispatchDecision(0, 1).action, "escalate");
  // A looser bound of 5: still re-dispatching at prior=3 (→4), escalates at prior=4 (→5).
  assert.equal(reDispatchDecision(3, 5).action, "re-dispatch");
  assert.equal(reDispatchDecision(4, 5).action, "escalate");
  // Junk prior counts are clamped to 0 (one attempt recorded), never negative/NaN.
  assert.deepEqual(reDispatchDecision(-7), {
    action: "re-dispatch",
    attempts: 1,
  });
  assert.deepEqual(reDispatchDecision(NaN), {
    action: "re-dispatch",
    attempts: 1,
  });
  // A non-positive bound falls back to the default (so a misconfig can't disable the loop bound).
  assert.equal(reDispatchDecision(2, 0).action, "escalate");
});

test("AC5: isEscalated trips at/above the bound, false below, fail-safe on junk", () => {
  assert.equal(isEscalated(0), false);
  assert.equal(isEscalated(2), false, "below the default bound of 3");
  assert.equal(isEscalated(3), true, "at the default bound");
  assert.equal(isEscalated(10), true);
  // custom bound
  assert.equal(isEscalated(1, 2), false);
  assert.equal(isEscalated(2, 2), true);
  // fail-safe: junk counts → 0 (not escalated), junk bound → default.
  assert.equal(isEscalated(-5), false);
  assert.equal(isEscalated(NaN), false);
  assert.equal(
    isEscalated(3, 0),
    true,
    "non-positive bound falls back to default 3",
  );
});

test("AC5: readyFrontier DROPS every unit of a slice that has reached its rework bound (escalated, not re-dispatched)", () => {
  // A slice with a coder AND a held-out test unit (disjoint footprints). Tests-first, the
  // frontier at rest holds only the test unit (the coder waits on it) — the invariant here
  // is that escalation drops EVERY unit the slice owns, test units included.
  const dag = buildUnitDag([
    slice("SP-6_SL-9", {
      workUnits: [
        { footprint: ["a.ts"], execution: "fan-out" },
        { footprint: ["t.test.ts"], execution: "fan-out", role: "test" },
      ],
    }),
  ]);

  // Below the bound (2 of 3 attempts) → still on the frontier: the loop keeps re-dispatching.
  const belowBound = readyFrontier(dag, {
    ...emptyState(),
    attempts: new Map([["SP-6_SL-9", 2]]),
  });
  assert.equal(
    belowBound.length,
    1,
    "a slice below its rework bound is still re-dispatchable (its test unit leads)",
  );

  // At the bound (3 attempts, default) → the WHOLE slice is excluded from the frontier.
  const atBound = readyFrontier(dag, {
    ...emptyState(),
    attempts: new Map([["SP-6_SL-9", 3]]),
  });
  assert.equal(
    atBound.length,
    0,
    "an escalated slice is no longer auto-re-dispatchable — every unit it owns is dropped",
  );

  // Sanity: with no attempts recorded the behaviour is unchanged (test unit dispatchable).
  assert.equal(readyFrontier(dag, emptyState()).length, 1);
});

test("AC5: readyFrontier respects a custom attemptBound when deciding escalation", () => {
  const dag = buildUnitDag([
    slice("SP-6_SL-9", {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }],
    }),
  ]);
  // bound of 1 → a single recorded failure escalates the slice off the frontier.
  const f = readyFrontier(dag, {
    ...emptyState(),
    attempts: new Map([["SP-6_SL-9", 1]]),
    attemptBound: 1,
  });
  assert.equal(f.length, 0, "custom attemptBound escalates earlier");
});

test("AC5: markEscalated stamps the durable marker idempotently; hasEscalationMarker detects it", () => {
  const diagnosis = "Behaviour diverged from intent: foo never reaches bar.";
  assert.equal(hasEscalationMarker(diagnosis), false);

  const marked = markEscalated(diagnosis);
  assert.ok(
    marked.includes(ESCALATION_MARKER),
    "the durable, reload-surviving escalation marker is stamped (asserted via the exported constant)",
  );
  assert.ok(marked.includes(diagnosis), "the original diagnosis is preserved");
  assert.equal(hasEscalationMarker(marked), true);

  // Idempotent: a second stamp does not accumulate a duplicate marker.
  const twice = markEscalated(marked);
  assert.equal(twice, marked);
  assert.equal(
    twice.split(ESCALATION_MARKER).length - 1,
    1,
    "the marker appears exactly once after re-stamping",
  );

  // An empty body still yields a detectable marker (the bare signal).
  assert.equal(hasEscalationMarker(markEscalated("")), true);
});

test("AC5: end-to-end — the loop re-dispatches up to the bound, then escalates and stops re-queuing", () => {
  // Tie reDispatchDecision (the verdict) to readyFrontier (the dispatch gate) and to the
  // durable marker: simulate red acceptance runs until the bound, asserting the slice is
  // never re-queued past escalation.
  const handle = "SP-6_SL-9";
  const dag = buildUnitDag([
    slice(handle, {
      workUnits: [{ footprint: ["a.ts"], execution: "fan-out" }],
    }),
  ]);

  let attempts = 0;
  let diagnosis = "intent divergence: the bar seam never reaches the baz core.";
  const dispatchable = () =>
    readyFrontier(dag, {
      ...emptyState(),
      attempts: new Map([[handle, attempts]]),
    }).length > 0;

  // Loop: each iteration represents one red acceptance run + its re-dispatch decision.
  let verdict: ReDispatchVerdict | undefined;
  for (let guard = 0; guard < 10; guard++) {
    // The slice must still be dispatchable while we are below the bound.
    assert.equal(
      dispatchable(),
      true,
      `still re-dispatchable before escalation (attempt ${attempts})`,
    );
    verdict = reDispatchDecision(attempts);
    attempts = verdict.attempts;
    if (verdict.action === "escalate") {
      diagnosis = markEscalated(diagnosis);
      break;
    }
  }

  assert.equal(
    verdict?.action,
    "escalate",
    "the bounded loop terminates in escalation",
  );
  assert.equal(
    attempts,
    MAX_REWORK_ATTEMPTS,
    "it escalated exactly at the bound",
  );
  assert.equal(
    hasEscalationMarker(diagnosis),
    true,
    "the requires-attention slice carries the durable escalation marker",
  );
  assert.equal(
    dispatchable(),
    false,
    "after escalation the slice is NOT re-queued — readyFrontier drops it, a human must decide",
  );
});

// ── SP-6/7: independent-verification roles + assessment ACs ────────────────
// A `test` unit is the held-out verifier — it KEEPS the ## Acceptance Criteria + satisfies (the
// inverse of the SP-6 SL-1 strip) so its probe can grade the exact criteria; a `code` unit strips
// them. Role is carried onto the SchedUnit by buildUnitDag. An `env: "assessment"` AC is graded by
// an injectable independent assessor, never a runnable command.

test("SP-6/7 AC1: a test unit KEEPS the Acceptance Criteria + satisfies; a code unit strips them", () => {
  const specBody = [
    "## Design",
    "",
    "Build foo end to end.",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] foo must round-trip losslessly",
  ].join("\n");
  const sliceBody = ["satisfies: [1]", "", "Wire foo."].join("\n");

  const testUnit: SchedUnit = {
    id: "SP-6_SL-1#eu-1",
    slice: "SP-6_SL-1",
    footprint: ["acceptance/SP-6.foo.test.ts"],
    requires: [],
    shape: "fan-out",
    role: "test",
  };
  const tp = buildWorkerPrompt(testUnit, "6", { specBody, sliceBody });
  // The held-out verifier SEES the exam — the ACs + satisfies are embedded.
  assert.match(tp, /Acceptance Criteria/);
  assert.match(tp, /foo must round-trip losslessly/);
  assert.match(tp, /satisfies/);
  // …and it is told the TRUTH, plainly (honest brief, 2026-07-08): it is the test author writing
  // up front, the implementation does not exist yet, a separate implementer builds to the same
  // contract after. Transparency about the process — never "you are the held-out grader" (which
  // would invite gaming) and never the implementer's code (independence is structural).
  assert.match(tp, /TEST AUTHOR/i);
  assert.match(tp, /implementation does not exist yet/i);
  assert.match(tp, /implementer will build/i);
  assert.doesNotMatch(tp, /held-out|independent verifier/i);

  const codeUnit: SchedUnit = {
    ...testUnit,
    id: "SP-6_SL-1#eu-0",
    role: "code",
  };
  const cp = buildWorkerPrompt(codeUnit, "6", { specBody, sliceBody });
  // The code-author never reads the rubric it is graded on.
  assert.doesNotMatch(cp, /Acceptance Criteria/);
  assert.doesNotMatch(cp, /foo must round-trip losslessly/);
  assert.doesNotMatch(cp, /satisfies/i);
  assert.doesNotMatch(cp, /HELD-OUT TEST-AUTHOR/);
});

test("SP-6/16: a test worker loses Bash/Web/Task but KEEPS Grep + Read/Glob (its cwd is the impl-free snapshot)", () => {
  // Structural independence: the tester's tree simply lacks the modifications, so Read/Glob are
  // unrestricted. The secondary control removes Bash (the roam / absolute-path vector) and Web/Task.
  // SP-6/16 RESTORED `Grep` for test workers (it is now scoped to the worker's own cwd snapshot, not
  // denied), so the SP-6/7-era assertion that `Grep` is denied is stale — correct it here so the
  // A code worker keeps the full tool set.
  const denied = disallowedToolsForRole("test");
  for (const t of ["Bash", "WebFetch", "WebSearch", "Task"])
    assert.ok(denied.includes(t), `test worker denies ${t}`);
  for (const t of ["Grep", "Read", "Glob", "Write", "Edit", "MultiEdit"])
    assert.ok(!denied.includes(t), `test worker keeps ${t}`);
  assert.deepEqual(disallowedToolsForRole("code"), []);
  assert.deepEqual(disallowedToolsForRole(undefined), []);
});

test("tests-first: a test worker is told it writes tests up front + redirect-aware terminate-on-denial", () => {
  const unit: SchedUnit = {
    id: "SP-6_SL-1#eu-1",
    slice: "SP-6_SL-1",
    footprint: ["src/acceptance/SP-6_3_AC-1.test.ts"],
    requires: [],
    shape: "fan-out",
    role: "test",
  };
  const tp = buildWorkerPrompt(unit, "6/3", {
    specBody: "## Acceptance Criteria\n\n- [ ] x",
  });
  // Honest tests-first workspace (2026-07-08): it is told plainly it writes the tests FIRST and
  // the implementation does not exist yet — not an obscure "snapshot" framing.
  assert.match(tp, /writing the tests FIRST/i);
  assert.match(tp, /does not exist in your working directory yet/i);
  assert.match(tp, /Import the contract's modules by the exact path\/name it gives/i);
  // No base-dir split anywhere (the old read-here/write-there model is gone).
  assert.doesNotMatch(tp, /base directory|READ-ONLY reference/i);
  // Terminate-on-denial, redirect-aware: never brute-force; follow a redirecting denial; stop
  // only at a genuine dead-end.
  assert.match(tp, /do NOT brute-force/i);
  assert.match(tp, /follow it and carry on/i);
  // A code worker gets no snapshot workspace block…
  const cp = buildWorkerPrompt({ ...unit, role: "code" }, "6/3", {
    specBody: "## Acceptance Criteria\n\n- [ ] x",
  });
  assert.doesNotMatch(cp, /writing the tests FIRST/i);
  // …but the terminate-on-denial instruction applies to EVERY worker.
  assert.match(cp, /do NOT brute-force/i);
});

test("SP-6/7: the test convention is injected for a test worker (it has no Bash to discover it)", () => {
  const unit: SchedUnit = {
    id: "SP-6_SL-1#eu-1",
    slice: "SP-6_SL-1",
    footprint: ["src/acceptance/SP-6_3_AC-1.test.ts"],
    requires: [],
    shape: "fan-out",
    role: "test",
  };
  const convention =
    "author your test to run via `node --test out-test/acceptance/…`";
  const tp = buildWorkerPrompt(unit, "6/3", {
    specBody: "## Acceptance Criteria\n\n- [ ] x",
    testConvention: convention,
  });
  assert.match(tp, /Test convention:/);
  assert.match(tp, /node --test/);
  // A code worker gets no convention block (it isn't withheld its tools).
  const cp = buildWorkerPrompt({ ...unit, role: "code" }, "6/3", {
    specBody: "## Acceptance Criteria\n\n- [ ] x",
    testConvention: convention,
  });
  assert.doesNotMatch(cp, /Test convention:/);
});

test("SP-6/7 AC1: role defaults to code — an unset role withholds the ACs", () => {
  const specBody = "## Acceptance Criteria\n\n- [ ] secret rubric";
  const unit: SchedUnit = {
    id: "SP-6_SL-9#eu-0",
    slice: "SP-6_SL-9",
    footprint: ["src/x.ts"],
    requires: [],
    shape: "fan-out",
  };
  assert.doesNotMatch(
    buildWorkerPrompt(unit, "6", { specBody }),
    /secret rubric/,
  );
});

test("SP-6/7 AC1: buildUnitDag carries role onto the SchedUnit (test vs code)", () => {
  const dag = buildUnitDag([
    slice("SP-6_SL-1", {
      workUnits: [
        { footprint: ["src/foo.ts"], execution: "fan-out", role: "code" },
        {
          footprint: ["acceptance/SP-6.foo.test.ts"],
          execution: "fan-out",
          role: "test",
        },
        // a role-less unit defaults to code.
        { footprint: ["src/bar.ts"], execution: "fan-out" },
      ] as WorkUnit[],
    }),
  ]);
  const byFp = (f: string) => dag.find((u) => u.footprint.includes(f));
  assert.equal(byFp("src/foo.ts")?.role, "code");
  assert.equal(byFp("acceptance/SP-6.foo.test.ts")?.role, "test");
  assert.equal(byFp("src/bar.ts")?.role, "code");
});

test("SP-6/7 AC1: batchExecutionUnits keeps serial code and serial test in separate role-uniform units", () => {
  const dag = buildUnitDag([
    slice("SP-6_SL-2", {
      workUnits: [
        { footprint: ["src/a.ts"], execution: "serial", role: "code" },
        { footprint: ["src/b.ts"], execution: "serial", role: "code" },
        {
          footprint: ["acceptance/a.test.ts"],
          execution: "serial",
          role: "test",
        },
      ] as WorkUnit[],
    }),
  ]);
  const codeNode = dag.find((u) => u.footprint.includes("src/a.ts"));
  const testNode = dag.find((u) =>
    u.footprint.includes("acceptance/a.test.ts"),
  );
  assert.notEqual(
    codeNode?.id,
    testNode?.id,
    "code and test serial units do not share a session",
  );
  assert.equal(codeNode?.role, "code");
  assert.deepEqual(codeNode?.footprint, ["src/a.ts", "src/b.ts"]);
  assert.equal(testNode?.role, "test");
});

test("SP-6/7 AC3: parseAcVerifications keeps an env:assessment entry even with no runnable command", () => {
  const verifs = parseAcVerifications({
    "1": { run: "npm test", env: "local" },
    "2": { run: "", env: "assessment" },
    "3": { env: "assessment" }, // run omitted entirely
  });
  const byAc = new Map(verifs.map((v) => [v.ac, v]));
  assert.equal(byAc.get(1)?.env, "local");
  assert.equal(
    byAc.get(2)?.env,
    "assessment",
    "an assessment AC survives with an empty run",
  );
  assert.equal(
    byAc.get(3)?.env,
    "assessment",
    "an assessment AC survives with no run at all",
  );
  // A non-assessment entry with no runnable command is still dropped (no silent green).
  const dropped = parseAcVerifications({ "1": { run: "", env: "local" } });
  assert.equal(dropped.length, 0);
});

test("SP-6/7 AC3: runAcVerifications routes an env:assessment AC to the injectable assessor with rationale", async () => {
  const verifs: AcVerification[] = [
    { ac: 1, run: "true", env: "local" },
    { ac: 2, run: "", env: "assessment" },
  ];
  const seen: { ac: number; intent: string; artifact: string }[] = [];
  const assess: AssessContext = {
    assessAc: async (ac, intent, artifact) => {
      seen.push({ ac: ac.ac, intent, artifact });
      return { pass: true, rationale: "the delivered UX matches the intent" };
    },
    intentFor: (ac) => `intent for AC ${ac}`,
    artifact: "the delivered change",
  };
  const exec: AcExec = async () => ({ code: 0, output: "ok" });
  const results = await runAcVerifications(verifs, "/repo", exec, assess);
  const byAc = new Map(results.map((r) => [r.ac, r]));
  // The runnable AC ran through exec; the assessment AC went to the assessor.
  assert.equal(byAc.get(1)?.pass, true);
  assert.equal(byAc.get(2)?.pass, true);
  assert.match(byAc.get(2)?.evidence ?? "", /assessment \(independent\)/);
  assert.match(byAc.get(2)?.evidence ?? "", /matches the intent/);
  assert.deepEqual(seen, [
    { ac: 2, intent: "intent for AC 2", artifact: "the delivered change" },
  ]);
});

test("SP-6/7 AC3: an assessment AC with NO assessor available is red (no skip), never silently green", async () => {
  const verifs: AcVerification[] = [{ ac: 1, run: "", env: "assessment" }];
  const results = await runAcVerifications(verifs, "/repo", async () => ({
    code: 0,
    output: "",
  }));
  assert.equal(results[0].pass, false);
  assert.match(results[0].evidence, /could not run: no independent assessor/);
});

// ── SP-6/7 AC4: a red acceptance run is judged and routed to the right role ──
// reDispatchDecision, given the judged code-vs-test fault, returns a ROUTE: re-dispatch the
// code-author for a `code` fault, the test-author for a `test` fault, or ESCALATE on `both` /
// at the attempt bound. With no fault it is the pure attempt-bound decision (backward-compatible).

test("SP-6/7 AC4: reDispatchDecision routes a code/test fault below the bound, escalates on both", () => {
  // A code fault below the bound → re-dispatch, routed to the code-author.
  const codeVerdict = reDispatchDecision(0, 3, "code");
  assert.equal(codeVerdict.action, "re-dispatch");
  assert.equal(codeVerdict.route, "code");

  // A test fault below the bound → re-dispatch, routed to the test-author.
  const testVerdict = reDispatchDecision(1, 3, "test");
  assert.equal(testVerdict.action, "re-dispatch");
  assert.equal(testVerdict.route, "test");

  // `both`/ambiguous → escalate REGARDLESS of the bound (the fault can't be singled out).
  const bothVerdict = reDispatchDecision(0, 3, "both");
  assert.equal(
    bothVerdict.action,
    "escalate",
    "an ambiguous fault escalates even on the first attempt",
  );
  assert.equal(bothVerdict.route, "both");

  // At the attempt bound a code fault ALSO escalates (the bound wins) — route still recorded.
  const boundVerdict = reDispatchDecision(2, 3, "code");
  assert.equal(boundVerdict.action, "escalate");
  assert.equal(boundVerdict.route, "code");
});

test("SP-6/7 AC4: reDispatchDecision with NO fault is the unchanged attempt-bound decision (no route key)", () => {
  // Backward-compat: the pure attempt-bound path omits the `route` key entirely.
  assert.deepEqual(reDispatchDecision(0), {
    action: "re-dispatch",
    attempts: 1,
  });
  assert.equal("route" in reDispatchDecision(0), false);
  assert.equal(reDispatchDecision(2, 3).action, "escalate");
});

// ── SP-6/9: a `contract` fault escalates to a contract re-cut WITHOUT burning an attempt ──
// When both hands conform to the contract yet still disagree on an undefined seam, the defect is the
// CONTRACT itself. reDispatchDecision's contract arm escalates (route: "contract") REGARDLESS of the
// prior count or bound, and — unlike every other path — leaves `attempts` === priorAttempts (the slice
// was never the problem, so no rework attempt is spent).

test("SP-6/9: reDispatchDecision routes a `contract` fault to escalate WITHOUT burning an attempt", () => {
  // First failure, well below the bound: still escalates (a contract defect is not re-rollable) and
  // the attempt counter is UNCHANGED (0 in → 0 out), not prior + 1.
  const first = reDispatchDecision(0, 3, "contract");
  assert.equal(first.action, "escalate");
  assert.equal(first.route, "contract");
  assert.equal(
    first.attempts,
    0,
    "the attempt is NOT burned (stays === priorAttempts)",
  );

  // Mid-bound: same verdict, attempts unchanged (2 in → 2 out).
  const mid = reDispatchDecision(2, 5, "contract");
  assert.deepEqual(mid, { action: "escalate", attempts: 2, route: "contract" });

  // AT/ABOVE the bound: still escalate, still unchanged — the bound is irrelevant to a contract defect.
  const atBound = reDispatchDecision(3, 3, "contract");
  assert.deepEqual(atBound, {
    action: "escalate",
    attempts: 3,
    route: "contract",
  });
  const aboveBound = reDispatchDecision(9, 3, "contract");
  assert.equal(
    aboveBound.attempts,
    9,
    "never bumped, whatever the prior count vs the bound",
  );

  // Contrast: a `code` fault at the same prior count DOES burn the attempt (prior + 1) — proving the
  // contract arm is the exception, not a general no-op.
  assert.equal(reDispatchDecision(2, 5, "code").attempts, 3);
});

test("SP-6/9: CONTRACT_DEFECT_MARKER is a non-empty peer of ESCALATION_MARKER naming the contract", () => {
  assert.equal(typeof CONTRACT_DEFECT_MARKER, "string");
  assert.ok(CONTRACT_DEFECT_MARKER.trim().length > 0, "non-empty");
  // Assert a SUBSTRING (per the contract) so the exact wording can evolve without breaking detection.
  assert.ok(
    /CONTRACT/i.test(CONTRACT_DEFECT_MARKER),
    "names the contract as the defect",
  );
  // A distinct marker from the exhausted-attempts one — different cause, different remedy.
  assert.notEqual(CONTRACT_DEFECT_MARKER, ESCALATION_MARKER);
});

test("SP-6/9: a `contract` route flows through buildVerificationTrace unchanged (Fault widened)", () => {
  const trace = buildVerificationTrace({
    round: 1,
    declared: [{ ac: 1, run: "acceptance/SP.probe.js" }],
    acResults: [{ ac: 1, pass: false, evidence: "$ probe → exit 1" }],
    routes: new Map<number, Fault>([[1, "contract"]]),
  });
  assert.equal(trace[0].verdict, "fail");
  assert.equal(
    trace[0].route,
    "contract",
    "the widened contract route is carried on the failed entry, unchanged",
  );
});

// ── SP-6/7 AC7: identical AC commands run once (de-dup) ─────────────────────

test("SP-6/7 AC7: runAcVerifications runs an identical command ONCE and maps it to every AC", async () => {
  const ran: string[] = [];
  const exec: AcExec = async (run) => {
    ran.push(run);
    return { code: run.includes("FAIL") ? 1 : 0, output: `out:${run}` };
  };
  const results = await runAcVerifications(
    [
      { ac: 1, run: "npm test" },
      { ac: 2, run: "npm test" }, // same command as AC1
      { ac: 3, run: "npm test" }, // and again
      { ac: 4, run: "step-FAIL" },
      { ac: 5, run: "step-FAIL" }, // a shared FAILING command is not re-run either
    ],
    "/wt",
    exec,
  );
  // Each DISTINCT command ran exactly once, in declared order.
  assert.deepEqual(ran, ["npm test", "step-FAIL"]);
  // …but every AC that declared it got its own mapped result.
  assert.deepEqual(
    results.map((r) => [r.ac, r.pass]),
    [
      [1, true],
      [2, true],
      [3, true],
      [4, false],
      [5, false],
    ],
  );
});

test("SP-6/7 AC7: a shared un-runnable command is cached red once, not re-attempted per AC", async () => {
  let calls = 0;
  const exec: AcExec = async () => {
    calls++;
    throw new Error("command not found");
  };
  const results = await runAcVerifications(
    [
      { ac: 1, run: "missing" },
      { ac: 2, run: "missing" },
    ],
    "/wt",
    exec,
  );
  assert.equal(calls, 1, "the failing command is attempted once, then cached");
  assert.ok(results.every((r) => !r.pass));
  assert.match(results[1].evidence, /could not run: command not found/);
});

// ── SP-6/7 AC5: durable, structured verification trace ─────────────────────

test("SP-6/7 AC5: buildVerificationTrace records kind, verdict, rationale, and route per AC", () => {
  const declared: AcVerification[] = [
    { ac: 1, run: "acceptance/SP.probe.js" }, // a held-out probe
    { ac: 2, run: "", env: "assessment" }, // an independent assessment
  ];
  const acResults: AcResult[] = [
    { ac: 1, pass: false, evidence: "$ acceptance/SP.probe.js → exit 1" },
    {
      ac: 2,
      pass: true,
      evidence: "assessment (independent) → pass: the UX matches",
    },
  ];
  const routes = new Map<number, Fault>([[1, "code"]]);
  const trace = buildVerificationTrace({
    round: 2,
    declared,
    acResults,
    routes,
  });

  const byAc = new Map(trace.map((e) => [e.ac, e]));
  assert.equal(byAc.get(1)?.kind, "probe");
  assert.equal(byAc.get(1)?.verdict, "fail");
  assert.equal(byAc.get(1)?.round, 2);
  assert.equal(
    byAc.get(1)?.route,
    "code",
    "a failed AC carries its judged route",
  );
  assert.match(byAc.get(1)?.rationale ?? "", /exit 1/);

  assert.equal(byAc.get(2)?.kind, "assessment");
  assert.equal(byAc.get(2)?.verdict, "pass");
  assert.equal(
    byAc.get(2)?.route,
    undefined,
    "a passing AC records no code-vs-test route",
  );
});

test("SP-6/7 AC5: round can be a per-AC lookup", () => {
  const trace = buildVerificationTrace({
    round: (ac) => ac * 10,
    declared: [{ ac: 1, run: "x" }],
    acResults: [{ ac: 1, pass: true, evidence: "ok" }],
  });
  assert.equal(trace[0].round, 10);
});

test("SP-6/7 AC5: mergeVerificationTrace accumulates across rounds and overwrites the same AC+round", () => {
  const round1: VerificationTraceEntry[] = [
    { ac: 1, round: 1, kind: "probe", verdict: "fail", route: "code" },
    { ac: 2, round: 1, kind: "assessment", verdict: "pass" },
  ];
  const round2: VerificationTraceEntry[] = [
    // AC1 re-verified in round 2 (now green) — a NEW round entry, not a replacement of round 1.
    { ac: 1, round: 2, kind: "probe", verdict: "pass" },
    // AC2 re-verified within round 1 (a re-run of the same round) — REPLACES the stale entry.
    { ac: 2, round: 1, kind: "assessment", verdict: "fail", route: "test" },
  ];
  const merged = mergeVerificationTrace(round1, round2);
  assert.equal(
    merged.length,
    3,
    "AC1 has two rounds; AC2 round-1 was overwritten",
  );
  // Sorted by round then AC.
  assert.deepEqual(
    merged.map((e) => [e.ac, e.round, e.verdict]),
    [
      [1, 1, "fail"],
      [2, 1, "fail"],
      [1, 2, "pass"],
    ],
  );
});

test("SP-6/7 AC5: buildDeliveryReport renders the verification-trace section when a trace is present", () => {
  const md = buildDeliveryReport({
    specNumber: "6",
    sha: "abc1234",
    files: ["src/a.ts"],
    units: [{ id: "SP-6_SL-1#eu-0", outcome: "success" }],
    declared: [{ ac: 1, run: "acceptance/probe.js" }],
    acResults: [{ ac: 1, pass: false, evidence: "$ probe → exit 1" }],
    advanced: [],
    committed: false,
    trace: [
      {
        ac: 1,
        round: 2,
        kind: "probe",
        verdict: "fail",
        rationale: "the probe never reached green",
        route: "code",
      },
    ],
  });
  assert.match(md, /Verification trace/);
  assert.match(md, /probe/);
  assert.match(md, /code/); // the route column
  assert.match(md, /the probe never reached green/);
});
