/**
 * Pure, vscode-free core of the thinking space orchestrator: the work-unit DAG +
 * scheduler, plus session-log helpers that parse a worker's persisted `.jsonl` events.
 * Mostly I/O-free — the `OrchestratorService` shell supplies thinking space rows + the event stream
 * and acts on the results. Unit-tested directly (high AI-testability per the lever);
 * the live SDK worker / advance is the shell's job — a human verdict (low AI-testability).
 *
 * The one I/O seam here is `runAcVerifications` (, the closing gate): it
 * spawns the Spec's declared per-AC checks. The actual spawn is behind an injectable `AcExec`
 * defaulting to `child_process` so the runner + the report builder stay unit-testable with fakes.
 */
// Prompt externalization (context tranche, 2026-07-14): the worker preamble's behavioural
// prose is editable doctrine (worker-preamble.md); the bundled fallback + the machine-parsed
// UNDELIVERED format stanza live here in code.


export interface WorkUnit {
  footprint: string[];
  /** Files a SIBLING unit produces that this unit reads (the contract-first reference).
   *  Resolved by `buildUnitDag` into a real dependency edge on the producing unit(s) —
   *  authorable without a node-id, so it works before the slice has a number. This is the
   *  ONLY authored dependency language: the ungrounded `depends_on` form was removed
   *  (SP-5/1) — `consumes`+footprint is the single edge source. */
  consumes?: string[];
  /** Files this unit READS but does NOT itself produce — the declared cross-unit read set
   *  (SP-6/2 AC2). Unlike `consumes` (which builds a dependency edge), `reads` is the authoring-time
   *  gate's input: at `create_slice` the pure undeclared-read check (in `parallelSlices.ts`) resolves
   *  each entry over the global producer map and refuses any read that lands on a SIBLING unit's
   *  footprint with no matching `consumes`. Declared (not inferred from a file that may not exist
   *  yet), so the gate runs at the door — `buildUnitDag` carries the field but derives no edge from it
   *  (edges remain `consumes`+footprint only). */
  reads?: string[];
  execution: "serial" | "mechanize" | "fan-out";
  /** Independent-verification role (SP-6/7 AC1). `code` (default) implements to the Spec's INTENT
   *  (ACs stripped from its prompt); `test` is the held-out verifier (keeps the ACs, its footprint
   *  is the reserved `acceptance/` probe). Carried onto {@link SchedUnit} by `buildUnitDag` and
   *  branched on by `buildWorkerPrompt`. Absent ⇒ `code` (backward-compatible). */
  role?: "code" | "test";
}

export interface ExecutionUnit {
  shape: "serial" | "mechanize" | "fan-out";
  units: WorkUnit[];
}

/**
 * Batch one slice's work units into **execution units** (a worker's assignment).
 *
 * **ONE CODER PER SLICE (tests-first repair, 2026-07-08):** every `role: code` unit —
 * serial, mechanize and fan-out alike — collapses into a SINGLE execution unit whose
 * footprint is the union and whose notes concatenate in authored order. The slice is the
 * unit of code scheduling: ACs (and therefore the held-out probes) exist at slice
 * granularity, so a test-driven loop only closes when one accountable coder owns the whole
 * coherent change. Per-file code fan-out was designed for blind writers; under the verify
 * oracle it fights the design. Parallelism lives BETWEEN slices (`parallel_group`), not
 * inside one.
 *
 * `role: test` units keep their granularity (per-AC fan-out; serial test units still share
 * one warm session) — and a `code` and a `test` unit never share a session (SP-6/7): the
 * test-author is the held-out verifier whose prompt keeps the ACs a code-author must not see.
 * Never spans slices — the caller passes a single slice's units.
 */
export function batchExecutionUnits(units: WorkUnit[]): ExecutionUnit[] {
  const out: ExecutionUnit[] = [];
  // All code-role units → ONE execution unit (one coder per slice), in authored order.
  const code = units.filter((u) => (u.role ?? "code") !== "test");
  if (code.length) out.push({ shape: "serial", units: code });
  // Test-role units keep the per-AC fan-out; serial test units batch into one warm session.
  const test = units.filter((u) => (u.role ?? "code") === "test");
  const serialTest = test.filter((u) => u.execution === "serial");
  if (serialTest.length) out.push({ shape: "serial", units: serialTest });
  for (const u of test.filter((u) => u.execution === "mechanize"))
    out.push({ shape: "mechanize", units: [u] });
  for (const u of test.filter((u) => u.execution === "fan-out"))
    out.push({ shape: "fan-out", units: [u] });
  return out;
}

