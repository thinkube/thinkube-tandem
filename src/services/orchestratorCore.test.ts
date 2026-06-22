/**
 * Unit tests for the orchestrator's pure core (SP-tgs8nz_SL-1) — the slice picker and the
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
  buildAttendPrompt,
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
  buildUnitDag,
  readyFrontier,
  buildWorkerPrompt,
  extractNeedsInput,
  sessionIdOf,
  NEEDS_INPUT_SENTINEL,
  parseAcVerifications,
  runAcVerifications,
  checkAcOrdinals,
  buildDeliveryReport,
  type SliceRow,
  type WorkUnit,
  type SliceForDag,
  type SchedulerState,
  type SchedUnit,
  type AcExec,
  type AcResult,
} from "./orchestratorCore";

test("pickNextSlice: first ready slice with all deps done is picked", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", dependsOn: [] },
  ];
  assert.equal(pickNextSlice(rows), "SP-1_SL-2");
});

test("pickNextSlice: a ready slice with an unfinished dep is skipped", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "doing", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", dependsOn: [] },
  ];
  // SL-2 blocked (dep doing); SL-3 free → SL-3.
  assert.equal(pickNextSlice(rows), "SP-1_SL-3");
});

test("pickNextSlice: a missing dep counts as not-done (blocks)", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-99"] },
  ];
  assert.equal(pickNextSlice(rows), null);
});

test("pickNextSlice: nothing ready → null", () => {
  const rows: SliceRow[] = [
    { handle: "SP-1_SL-1", status: "done", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "doing", dependsOn: [] },
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
    { handle: "SP-1_SL-1", status: "done", dependsOn: [] },
    { handle: "SP-1_SL-2", status: "ready", dependsOn: ["SP-1_SL-1"] },
    { handle: "SP-1_SL-3", status: "ready", dependsOn: ["SP-1_SL-99"] }, // blocked
    { handle: "SP-1_SL-4", status: "ready", dependsOn: [] },
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

test("buildAttendPrompt: names the slice, includes the diagnosis + the return-to-Ready exit", () => {
  const p = buildAttendPrompt("SP-1_SL-2", "verifier red");
  assert.match(p, /SP-1_SL-2/);
  assert.match(p, /verifier red/);
  assert.match(p, /back to Ready/);
  // No diagnosis → still names the slice + the exit, no dangling "diagnosis:" label.
  assert.doesNotMatch(buildAttendPrompt("SP-1_SL-2"), /diagnosis/i);
});

test("batchExecutionUnits: serial units collapse to one; mechanize/fan-out stay separate", () => {
  const units: WorkUnit[] = [
    { footprint: ["a"], execution: "serial" },
    { footprint: ["b"], execution: "serial" },
    { footprint: ["c"], execution: "mechanize" },
    { footprint: ["d"], execution: "fan-out" },
    { footprint: ["e"], execution: "fan-out" },
  ];
  const eu = batchExecutionUnits(units);
  assert.equal(eu.length, 4); // 1 serial batch + 1 mechanize + 2 fan-out
  assert.equal(eu[0].shape, "serial");
  assert.equal(eu[0].units.length, 2);
  assert.deepEqual(eu.filter((u) => u.shape === "fan-out").length, 2);
});

// ── buildUnitDag + readyFrontier (SP-tgs8nz makespan scheduler) ────────────

const slice = (handle: string, o: Partial<SliceForDag> = {}): SliceForDag => ({
  handle,
  status: o.status ?? "ready",
  dependsOn: o.dependsOn ?? [],
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

test("buildUnitDag: serial units of a slice collapse into one node; fan-out splits", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [
        { footprint: ["a.ts"], execution: "serial" },
        { footprint: ["b.ts"], execution: "serial" },
        { footprint: ["c.ts"], execution: "fan-out", note: "do c" },
        { footprint: ["d.ts"], execution: "fan-out", note: "do d" },
      ],
    }),
  ]);
  // 1 serial node (a+b) + 2 fan-out nodes = 3
  assert.equal(dag.length, 3);
  const serial = dag.find((u) => u.shape === "serial")!;
  assert.deepEqual(serial.footprint.sort(), ["a.ts", "b.ts"]);
  const fans = dag.filter((u) => u.shape === "fan-out");
  assert.equal(fans.length, 2);
  assert.equal(fans[0].note, "do c");
});

test("buildUnitDag: units inherit their slice's depends_on, pooled across slices", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", { files: ["a.ts"] }),
    slice("SP-1_SL-2", {
      dependsOn: ["SP-1_SL-1"],
      workUnits: [
        { footprint: ["b.ts"], execution: "fan-out" },
        { footprint: ["c.ts"], execution: "fan-out" },
      ],
    }),
  ]);
  // one node for SL-1, two for SL-2 — pooled into one DAG across slices
  assert.equal(dag.length, 3);
  for (const u of dag.filter((u) => u.slice === "SP-1_SL-2"))
    assert.deepEqual(u.dependsOn, ["SP-1_SL-1"]);
});

const emptyState = (over: Partial<SchedulerState> = {}): SchedulerState => ({
  done: over.done ?? new Set(),
  running: over.running ?? new Set(),
  blocked: over.blocked ?? new Set(),
});

test("readyFrontier: independent disjoint units are all ready (max parallelism)", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [
        { footprint: ["a.ts"], execution: "fan-out" },
        { footprint: ["b.ts"], execution: "fan-out" },
        { footprint: ["c.ts"], execution: "fan-out" },
      ],
    }),
  ]);
  const f = readyFrontier(dag, emptyState());
  assert.equal(f.length, 3);
});

test("readyFrontier: a unit waits until its slice-dep is done", () => {
  const dag = buildUnitDag([
    slice("SP-1_SL-1", { files: ["a.ts"] }),
    slice("SP-1_SL-2", { dependsOn: ["SP-1_SL-1"], files: ["b.ts"] }),
  ]);
  // SL-1 not done → only SL-1's unit is ready
  let f = readyFrontier(dag, emptyState());
  assert.deepEqual(
    f.map((u) => u.id),
    ["SP-1_SL-1"],
  );
  // mark SL-1 done → SL-2's unit becomes ready
  f = readyFrontier(dag, emptyState({ done: new Set(["SP-1_SL-1"]) }));
  assert.deepEqual(
    f.map((u) => u.id),
    ["SP-1_SL-2"],
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
  const dag = buildUnitDag([
    slice("SP-1_SL-1", {
      workUnits: [
        { footprint: ["a.ts"], execution: "fan-out" },
        { footprint: ["b.ts"], execution: "fan-out" },
      ],
    }),
  ]);
  const f = readyFrontier(dag, emptyState({ running: new Set(["a.ts"]) }));
  assert.deepEqual(
    f.map((u) => u.footprint[0]),
    ["b.ts"],
  );
});

test("readyFrontier: critical-path first — the unit with the longest chain leads", () => {
  // SL-1 (a) → SL-2 (b) → SL-3 (c) chain, plus an independent SL-4 (d).
  // At the start only SL-1 and SL-4 are ready; SL-1 has the longer chain → first.
  const dag = buildUnitDag([
    slice("SP-1_SL-1", { files: ["a.ts"] }),
    slice("SP-1_SL-2", { dependsOn: ["SP-1_SL-1"], files: ["b.ts"] }),
    slice("SP-1_SL-3", { dependsOn: ["SP-1_SL-2"], files: ["c.ts"] }),
    slice("SP-1_SL-4", { files: ["d.ts"] }),
  ]);
  const f = readyFrontier(dag, emptyState());
  assert.equal(f[0].id, "SP-1_SL-1", "longest-chain unit dispatched first");
});

test("readyFrontier: blocked units (requires-attention slice) are not dispatched", () => {
  const dag = buildUnitDag([slice("SP-1_SL-1", { files: ["a.ts"] })]);
  const f = readyFrontier(dag, emptyState({ blocked: new Set(["SP-1_SL-1"]) }));
  assert.equal(f.length, 0);
});

// ── needs-input + worker prompt (SP-tgs8nz_SL-3) ───────────────────────────

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
    dependsOn: [],
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
  const withCtx = buildWorkerPrompt(unit, "3", {
    specBody: "## Acceptance Criteria\n- [ ] headlamp deploys",
    sliceBody: "Pinned: namespace headlamp",
  });
  assert.match(withCtx, /Acceptance Criteria/);
  assert.match(withCtx, /Pinned: namespace headlamp/);
  assert.match(withCtx, /NOT in this worktree/);
});

// ── Closing AI-verification gate (SP-tgzyfy / TEP-tgzx3p) ───────────────────

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
  assert.match(md, /Acceptance-criteria verification/);
  assert.match(md, /#1 \|.*✓ pass/);
  assert.match(md, /#2 \|.*✗ fail/);
  assert.match(md, /assertion failed/); // evidence excerpt present
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
