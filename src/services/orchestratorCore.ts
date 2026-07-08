/**
 * Pure, vscode-free core of the thinking space orchestrator (SP-tgs8nz_SL-1): the work-unit DAG +
 * scheduler, plus session-log helpers that parse a worker's persisted `.jsonl` events.
 * Mostly I/O-free — the `OrchestratorService` shell supplies thinking space rows + the event stream
 * and acts on the results. Unit-tested directly (high AI-testability per the lever, SP-tgsdvw);
 * the live SDK worker / advance is the shell's job — a human verdict (low AI-testability).
 *
 * The one I/O seam here is `runAcVerifications` (SP-tgzyfy / TEP-tgzx3p, the closing gate): it
 * spawns the Spec's declared per-AC checks. The actual spawn is behind an injectable `AcExec`
 * defaulting to `child_process` so the runner + the report builder stay unit-testable with fakes.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface SliceRow {
  /** Slice handle, e.g. "SP-3_SL-2". */
  handle: string;
  /** Frontmatter status: ready | doing | done | archived. */
  status: string;
  /** `depends_on` handles. */
  requires: string[];
}

/**
 * Pick the next dispatchable slice: the first **ready** slice (in input order) whose every
 * `requires` handle is **done**. Returns its handle, or null if none is dispatchable. A
 * dep missing from `rows` counts as not-done (blocks) — fail safe. One-in-flight / the
 * concurrency cap is the shell's concern, not this picker's.
 */
export function pickNextSlice(rows: SliceRow[]): string | null {
  return pickFrontier(rows)[0] ?? null;
}

/**
 * The **ready frontier**: every dispatchable slice (status **ready** with every `requires`
 * **done**), in input order. SL-2's bounded fan-out runs a footprint-disjoint subset of this
 * up to the per-Spec concurrency cap; SL-1's `pickNextSlice` is just its width-1 head.
 */
export function pickFrontier(rows: SliceRow[]): string[] {
  const statusOf = new Map(
    rows.map((r) => [r.handle, (r.status ?? "").toLowerCase()]),
  );
  return rows
    .filter((r) => (r.status ?? "").toLowerCase() === "ready")
    .filter((r) => !(r.requires ?? []).some((d) => statusOf.get(d) !== "done"))
    .map((r) => r.handle);
}

/**
 * Greedy **footprint-disjoint** subset of frontier candidates (input order): take a candidate
 * iff its footprint shares no path with any already-taken one. Two slices that would touch the
 * same file are never dispatched concurrently — the ownership arbiter enforces this at runtime,
 * this pre-selects so we don't even spawn a doomed worker.
 */
export function selectDisjoint(
  items: { handle: string; footprint: string[] }[],
): string[] {
  const taken = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const fp = it.footprint ?? [];
    if (fp.some((f) => taken.has(f))) continue;
    fp.forEach((f) => taken.add(f));
    out.push(it.handle);
  }
  return out;
}

/**
 * Run `worker` over `items` with at most `cap` (≥1) in flight; a wider set **queues** and
 * drains as slots free (AC3 — the per-Spec worker cap). Results are returned in input
 * order; a worker that throws rejects the whole run (callers wrap per-item as needed).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  cap: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(cap));
  const results = new Array<R>(items.length);
  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runner()),
  );
  return results;
}

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

// ── Work-unit DAG scheduler (SP-tgs8nz: makespan over the Spec's units) ──────
//
// The schedulable atom is an **execution unit** (a worker's assignment): a slice's
// work units batched by shape (serial → one ordered session; mechanize/fan-out →
// one each). The DAG pools every slice's execution units — units may **span
// slices** (the slice is only a validation label), never Specs. The scheduler keeps
// the worker pool saturated: ready frontier (deps-done ∧ footprint-disjoint),
// critical-path first. Pure + unit-tested; the shell maintains done/running state.

/** A slice + its frontmatter — the input to building the Spec's work-unit DAG. */
export interface SliceForDag {
  handle: string;
  /** ready | doing | done | requires-attention | archived. */
  status: string;
  /**
   * @deprecated Authored slice-level `depends_on` is RETIRED (SP-5/1): it is never read —
   * `buildUnitDag` sources every edge from `consumes`+footprint. Retained as an optional,
   * ignored field only so the few remaining callers that still pass it keep compiling; do
   * not author new uses. The grounded replacement is a unit `consumes`.
   */
  requires?: string[];
  /** Declared `files:` (the footprint for a unit-less legacy slice). */
  files: string[];
  /** `work_units` (may be empty → the whole slice is one serial unit). */
  workUnits: (WorkUnit & { note?: string })[];
  /** 1-based AC ordinals the slice `satisfies` — the closing gate (SP-tgzyfy) advances the slice
   *  to Done only when these ACs' verifications all ran green, then ticks exactly these on the Spec. */
  satisfies?: number[];
  /** The slice's design-time CONTRACT (SP-6/3): the shared interface — the exact exports, types
   *  and behaviour — every unit builds against. Established by the slicer WHEN THE SLICE IS
   *  CREATED (not a work unit, not derived), and injected into every worker prompt so code and
   *  held-out test alike agree on the seam WITHOUT consuming each other. Because the contract
   *  pins the interface up front, contract-defined slices need `consumes` only for a genuine
   *  produced-artifact dependency (a unit ingesting another unit's OUTPUT), not for interfaces. */
  contract?: string;
}

/** A schedulable execution unit — one worker's assignment. */
export interface SchedUnit {
  /** `${slice}#eu-${i}`, or the slice handle for a unit-less (legacy) slice. */
  id: string;
  /** Parent slice handle — the validation label (a slice verifies when all its units land). */
  slice: string;
  /** Files this unit touches (∪ of its work units' footprints). */
  footprint: string[];
  /** Unit + slice ids this unit waits on. */
  requires: string[];
  shape: "serial" | "mechanize" | "fan-out";
  /** Independent-verification role (SP-6/7 AC1), carried from the underlying work units. `test` ⇒
   *  the held-out verifier: `buildWorkerPrompt` KEEPS the ACs in its prompt and its footprint is the
   *  reserved `acceptance/` probe. Absent/`code` ⇒ the intent-only implementer (ACs stripped). */
  role?: "code" | "test";
  /** The unit's task text(s), for the worker prompt. */
  note?: string;
  /** The Spec-wide design-time contract (SP-6/3): the UNION of every slice's declared contract,
   *  injected verbatim into this unit's worker prompt so code and held-out test — in ANY slice —
   *  build to the same interface, including seams another slice defines. Computed by buildUnitDag. */
  contract?: string;
  /** The underlying work units (for the worker prompt + footprint). */
  units?: WorkUnit[];
}

/**
 * Expand a Spec's slices into the **execution-unit DAG** the scheduler runs over: each
 * slice's work units are batched by shape (`batchExecutionUnits`), and every resulting
 * execution unit becomes a node — pooled across all slices into one graph. A slice with
 * no `work_units` (legacy) becomes ONE serial node whose footprint is its declared
 * `files`.
 *
 * **`consumes`+footprint is the only edge language (SP-5/1).** A unit's dependency edges
 * come solely from its `consumes`: each consumed file is resolved, over the **global** set
 * of every slice's execution units, to the unit(s) whose footprint **produces** that file —
 * so a `consumes` always lands on the real producer, anywhere in the Spec, across slice
 * boundaries (the #27 regression was a per-slice `fileToNode` that couldn't see producers in
 * sibling slices). A file written by **multiple** units resolves to **all** of them, so a
 * consumer depends on every writer (it always reads the file fully written). The authored
 * `depends_on` forms (slice-level and work-unit-level) and the old slice-handle `expand()`
 * path are gone; an independent cross-slice unit that consumes nothing gets no edge.
 */
export function buildUnitDag(slices: SliceForDag[]): SchedUnit[] {
  const normFile = (f: string) => f.replace(/^\.\//, "");

  // SP-6/3: the CONTRACT is Spec-shared, not slice-local. Each slice declares the interfaces it
  // introduces; the shared seam for the whole feature is the UNION of every slice's contract. It is
  // stamped on every unit — across ALL slices — so a unit in one slice builds against an interface
  // another slice defines (e.g. a webview slice against the token/store a headless-gate slice owns).
  // This is the cross-slice interface agreement that `consumes`-between-slices used to carry; genuine
  // produced-artifact `consumes` stays cross-slice too, so nothing loses cross-slice reach.
  const specContract =
    slices
      .map((s) => s.contract?.trim())
      .filter((c): c is string => !!c)
      .join("\n\n") || undefined;

  // Batch each unit-bearing slice's work units into execution units once; a unit-less
  // (legacy) slice has none (it becomes a single serial node keyed by its bare handle).
  const eusBySlice = new Map<string, ExecutionUnit[]>();
  for (const s of slices) {
    const units = s.workUnits ?? [];
    if (units.length > 0) eusBySlice.set(s.handle, batchExecutionUnits(units));
  }

  // GLOBAL producer map: file → the node-id(s) that produce it, built ONCE over EVERY
  // slice's execution units (and each unit-less slice's declared `files`). Hoisting this
  // out of the per-slice loop is the fix — a `consumes` now resolves against the whole
  // Spec, not just its own slice (the cross-slice edge #27 needed). Multiple producers of
  // the same file all map to it (multi-writer fan-in).
  const fileToNodes = new Map<string, string[]>();
  const addProducer = (file: string, id: string): void => {
    const key = normFile(file);
    const arr = fileToNodes.get(key) ?? [];
    if (!arr.includes(id)) arr.push(id);
    fileToNodes.set(key, arr);
  };
  for (const s of slices) {
    const eus = eusBySlice.get(s.handle);
    if (!eus) {
      for (const f of s.files ?? []) addProducer(f, s.handle);
      continue;
    }
    eus.forEach((eu, i) => {
      const id = `${s.handle}#eu-${i}`;
      for (const u of eu.units)
        for (const f of u.footprint ?? []) addProducer(f, id);
    });
  }

  const out: SchedUnit[] = [];
  for (const s of slices) {
    const eus = eusBySlice.get(s.handle);
    if (!eus) {
      out.push({
        id: s.handle,
        slice: s.handle,
        footprint: s.files ?? [],
        requires: [],
        shape: "serial",
        contract: specContract,
      });
      continue;
    }
    // TESTS-FIRST (repair, 2026-07-08): compute each execution unit's role up front so the
    // slice's code unit can be dependency-gated on ALL its same-slice test units — the
    // held-out probes are authored before the coder dispatches, and the coder then iterates
    // against them through the verify oracle. Same-slice only; the edge is implicit and
    // deterministic (never authored).
    const roleOf = (eu: ExecutionUnit): "code" | "test" =>
      eu.units.every((u) => (u.role ?? "code") === "test") ? "test" : "code";
    const testIds = eus.flatMap((eu, i) =>
      roleOf(eu) === "test" ? [`${s.handle}#eu-${i}`] : [],
    );
    eus.forEach((eu, i) => {
      const thisId = `${s.handle}#eu-${i}`;
      const footprint = [
        ...new Set(eu.units.flatMap((u) => u.footprint ?? [])),
      ];
      // The unit's edges: resolve each consumed file to ALL its producers over the
      // global map, dropping self-references (a unit consuming a file in its own footprint).
      const consumesDeps = eu.units.flatMap((u) =>
        ((u as WorkUnit & { consumes?: string[] }).consumes ?? []).flatMap(
          (c) => fileToNodes.get(normFile(c)) ?? [],
        ),
      );
      // Role carried onto the SchedUnit (SP-6/7 AC1): an execution unit is `test` only when EVERY
      // underlying work unit is `test` (batchExecutionUnits keeps batches role-uniform), else
      // `code`. `buildWorkerPrompt` branches on this.
      const role = roleOf(eu);
      // Tests-first: the slice's (single, collapsed) code unit waits on every same-slice
      // test unit, so the probes exist before the coder starts.
      const testsFirstDeps = role === "code" ? testIds : [];
      const requires = [
        ...new Set(
          [...consumesDeps, ...testsFirstDeps].filter((id) => id !== thisId),
        ),
      ];
      const note =
        eu.units
          .map((u) => (u as WorkUnit & { note?: string }).note)
          .filter(Boolean)
          .join("; ") || undefined;
      out.push({
        id: thisId,
        slice: s.handle,
        footprint,
        requires,
        shape: eu.shape,
        role,
        note,
        contract: specContract,
        units: eu.units,
      });
    });
  }
  return out;
}

/** The scheduler's live state: what's done, what's running, what's not dispatchable. */
export interface SchedulerState {
  /** Ids known done — completed execution-unit ids AND handles of done slices. */
  done: Set<string>;
  /** Footprints (files) currently held by running units. */
  running: Set<string>;
  /** Unit ids that must not be dispatched (slice doing-elsewhere / requires-attention / archived). */
  blocked: Set<string>;
  /**
   * SP-6 AC5 — the per-SLICE re-dispatch counter: slice handle → number of failed rework attempts
   * recorded for it. A slice whose count has reached {@link SchedulerState.attemptBound} is
   * **escalated** ({@link isEscalated}) and {@link readyFrontier} drops every unit it owns, so the
   * loop stops auto-re-queuing it toward green and a human must intervene. Omitted/absent ⇒ zero
   * attempts ⇒ never escalated (the pre-SP-6 behaviour is unchanged when callers don't track it).
   */
  attempts?: ReadonlyMap<string, number>;
  /**
   * SP-6 AC5 — the per-slice rework bound; defaults to {@link MAX_REWORK_ATTEMPTS} when omitted.
   * Once a slice's recorded attempts reach this bound it is escalated rather than re-dispatched.
   */
  attemptBound?: number;
}

/**
 * The dependency-ordering invariant (SP-6/2 AC1), named and exported so it is **load-bearing**
 * rather than an inline filter clause a refactor could silently weaken: an execution unit's
 * `requires` are *satisfied* only when EVERY id in them is in `done`. A `requires` entry that is
 * unresolved (names no unit that will ever be `done`) or merely pending is — by `done.has(d)` —
 * treated as not-done, so the predicate is **fail-safe**: a missing or pending producer blocks the
 * consumer, it never opens it. This is the single gate that guarantees no consumer is dispatched
 * before its producer has landed; `readyFrontier` MUST route every candidate through it.
 */
export function requiresSatisfied(
  requires: string[] | undefined,
  done: ReadonlySet<string>,
): boolean {
  return (requires ?? []).every((d) => done.has(d));
}

/**
 * The scheduler's **ready frontier**: execution units that are not done, not blocked, whose
 * every dependency is satisfied (`done`), and whose footprint doesn't overlap a running unit
 * — ordered **critical-path first** (longest remaining chain of dependents) and narrowed to a
 * footprint-**disjoint** set so a batch dispatched together can't collide. A slice-handle dep
 * is satisfied once the shell marks that slice done (all its units landed).
 *
 * **Dependency-ordering invariant (SP-6/2 AC1, pinned):** the `requiresSatisfied` gate below is
 * what makes "no consumer dispatched before its producer" load-bearing — a unit with any pending
 * or unresolved `requires` is filtered out here and can NEVER reach the ordering / disjoint passes
 * (those only ever see units already past the gate), so it is absent from the frontier until every
 * producer it depends on is `done`.
 *
 * **Bounded re-dispatch (SP-6/6 AC5):** a unit whose parent SLICE has reached the rework bound is
 * **escalated** and dropped from the frontier here — {@link isEscalated} consults `state.attempts`
 * against `state.attemptBound` (default {@link MAX_REWORK_ATTEMPTS}), so once a slice has failed its
 * bounded number of rework attempts it is no longer auto-re-dispatchable and is left awaiting a human
 * decision (the shell carries the durable {@link ESCALATION_MARKER} on the requires-attention slice).
 */
export function readyFrontier(
  units: SchedUnit[],
  state: SchedulerState,
): SchedUnit[] {
  const { done, running, blocked } = state;
  const attempts = state.attempts;
  const bound = state.attemptBound;
  const candidates = units.filter(
    (u) =>
      !done.has(u.id) &&
      !blocked.has(u.id) &&
      !u.footprint.some((f) => running.has(f)) &&
      // AC1: a consumer is dispatchable only once EVERY producer it `requires` has landed.
      requiresSatisfied(u.requires, done) &&
      // AC5: a slice past its rework bound is escalated — never re-dispatched, awaits a human.
      !isEscalated(attempts?.get(u.slice) ?? 0, bound),
  );

  // critical-path order: longest remaining chain of dependents first.
  const dependents = new Map<string, string[]>();
  for (const u of units)
    for (const d of u.requires ?? []) {
      const arr = dependents.get(d) ?? [];
      arr.push(u.id);
      dependents.set(d, arr);
    }
  const depthCache = new Map<string, number>();
  const depth = (id: string, seen: Set<string> = new Set()): number => {
    const c = depthCache.get(id);
    if (c != null) return c;
    if (seen.has(id)) return 0; // cycle guard (validateDag rejects real cycles upstream)
    seen.add(id);
    const kids = dependents.get(id) ?? [];
    const d = kids.length
      ? 1 + Math.max(...kids.map((k) => depth(k, new Set(seen))))
      : 0;
    depthCache.set(id, d);
    return d;
  };
  const ordered = [...candidates].sort(
    (a, b) => depth(b.id) - depth(a.id) || a.id.localeCompare(b.id),
  );

  // footprint-disjoint subset: a batch dispatched together must not collide.
  const taken = new Set<string>();
  const out: SchedUnit[] = [];
  for (const u of ordered) {
    if (u.footprint.some((f) => taken.has(f))) continue;
    u.footprint.forEach((f) => taken.add(f));
    out.push(u);
  }
  return out;
}

// ── Bounded re-dispatch + escalation (SP-6/6 AC5) ──────────────────────────
//
// The failure→fix loop must not re-queue a slice toward green forever. After a bounded
// number of failed rework attempts on the SAME slice the orchestrator stops re-dispatching
// and escalates: the slice is left `requires-attention` with a durable escalation marker and
// is excluded from the ready frontier, so a human must decide. The decision is pure /
// deterministic (no LLM) — the bound and the escalate-vs-re-dispatch verdict are control-plane,
// per the Spec's constraint that the loop bound must not use a model.

/**
 * Default per-slice bound on failed rework attempts before escalation (SP-6/6 AC5). Counts the
 * number of failed acceptance runs recorded for a slice; once a slice reaches this many, the loop
 * escalates instead of re-dispatching. Overridable per run via {@link SchedulerState.attemptBound}.
 */
export const MAX_REWORK_ATTEMPTS = 3;

/**
 * The durable marker the orchestrator stamps onto an **escalated** slice's `## ⚑ Requires attention`
 * block (SP-6/6 AC5). It is the human-facing, reload-surviving signal that the bounded loop gave up
 * on auto-re-dispatch: a slice carrying it is awaiting a human decision, not a re-queue. Detected by
 * {@link hasEscalationMarker} and stamped by {@link markEscalated}; the test asserts via THIS constant
 * (never a hand-copied string) so the marker and its detector can never silently diverge.
 */
export const ESCALATION_MARKER =
  "⛔ ESCALATED — bounded rework attempts exhausted";

/**
 * The durable marker the orchestrator stamps onto a **contract-attributed** escalation (SP-6/9) — a
 * peer to {@link ESCALATION_MARKER} that names the CONTRACT (not a role) as the defect. When the judge
 * triangulates a red slice to `fault: contract` (both hands conform to the contract yet still disagree
 * on a seam the contract never defined), the requires-attention diagnosis leads with THIS marker so the
 * human-facing signal reads "the contract is incomplete" and routes to a contract re-cut — NOT another
 * bounded role-rework guess. Non-empty and contains "CONTRACT" (assert a SUBSTRING, never equality, so
 * the wording can evolve without breaking the detector). Distinct from the exhausted-attempts marker
 * because its cause and its remedy differ: this is a design defect the slicer re-cuts, and no rework
 * attempt is burned reaching it.
 */
export const CONTRACT_DEFECT_MARKER =
  "⛔ CONTRACT-DEFECT — the contract is incomplete";

/**
 * Has a slice **crossed its rework bound** (SP-6/6 AC5)? True once the recorded failed-attempt count
 * reaches the bound (default {@link MAX_REWORK_ATTEMPTS}) — at which point {@link readyFrontier} drops
 * every unit the slice owns, so it is no longer auto-re-dispatchable. Fail-safe on junk input: a
 * negative / non-finite count is treated as zero, a non-positive bound falls back to the default.
 * Pure.
 */
export function isEscalated(
  attempts: number,
  bound: number = MAX_REWORK_ATTEMPTS,
): boolean {
  const n = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  const b =
    Number.isFinite(bound) && bound >= 1
      ? Math.floor(bound)
      : MAX_REWORK_ATTEMPTS;
  return n >= b;
}

/**
 * The role a failed acceptance run is attributed to (SP-6/7 AC4): the **code**-author (the
 * implementation diverged from intent), the **test**-author (the held-out probe is itself wrong), or
 * `both` / ambiguous (neither can be singled out → escalate to a human), or — SP-6/9 — **`contract`**:
 * both hands conform to the contract yet the red pivots on a seam the contract never defined, so the
 * defect is the CONTRACT itself and the slice routes to a contract re-cut (not another role guess). The
 * verdict of {@link JudgeFailure}; routes {@link reDispatchDecision}.
 */
export type Fault = "code" | "test" | "both" | "contract";

/**
 * An independent judge's verdict on a red acceptance run (SP-6/7 AC4): which role is at fault plus the
 * **rationale** (why), so the routing decision is recordable in the verification trace. The same
 * independent-judgment shape as {@link AcAssessment} — a verdict WITH a rationale.
 */
export interface FailureJudgment {
  fault: Fault;
  rationale: string;
}

/**
 * Judge a FAILED acceptance verification (SP-6/7 AC4) — the same independent-judgment primitive as
 * {@link AssessAc}: a fresh session, NEVER the implementing worker, returning a verdict + rationale.
 * Given the failing unit + the failure evidence it decides whether the fault lies in the CODE or the
 * TEST (or both), so {@link reDispatchDecision} can route the re-dispatch to the right role (or
 * escalate on `both`). Injectable so the gate is unit-testable with no live model; the real
 * SDK-session dispatch lives in `OrchestratorService`.
 *
 * SP-6/9: gains an optional 3rd arg — the slice's CONTRACT, the triangulation arbiter. The judge
 * decides each hand's conformance against the contract itself (not by comparing the two hands), which
 * is what lets it return the `contract` fault when both conform yet still disagree on an undefined seam.
 */
export type JudgeFailure = (
  unit: Pick<SchedUnit, "id" | "slice" | "role">,
  failure: string,
  contract?: string,
) => Promise<FailureJudgment>;

/** One verdict from {@link reDispatchDecision}: whether to send a red slice back for rework or stop. */
export interface ReDispatchVerdict {
  /** `re-dispatch` → bump the counter and return the slice to the ready frontier; `escalate` → leave
   *  it `requires-attention` with the {@link ESCALATION_MARKER}, excluded from the frontier (AC5). */
  action: "re-dispatch" | "escalate";
  /** The slice's new failed-attempt count (prior + 1), to persist on `state.attempts`. */
  attempts: number;
  /** SP-6/7 AC4: which role the re-dispatch targets — set ONLY when a judged `fault` was supplied.
   *  `code`/`test` route the re-author to that role; `both` forces escalation (ambiguous); SP-6/9
   *  `contract` forces escalation to a contract re-cut (attempts NOT burned). Absent when no fault is
   *  given (the pure attempt-bound decision), so the AC5 behaviour is unchanged. */
  route?: Fault;
}

/**
 * The pure, deterministic re-dispatch decision for a slice that just failed its (independently-graded)
 * acceptance run (SP-6/6 AC5 + SP-6/7 AC4). Given the slice's PRIOR recorded failed-attempt count, the
 * bound (default {@link MAX_REWORK_ATTEMPTS}), and — when the failure was judged — the code-vs-test
 * `fault`, it increments the counter and decides:
 *
 *   • while the new count is below the bound AND the fault is not ambiguous, the slice is
 *     **re-dispatched** for another bounded rework attempt, routed (`route`) to the faulting role —
 *     the code-author for a `code` fault, the test-author for a `test` fault;
 *   • once the count reaches the bound, OR the fault is `both`/ambiguous, the loop **escalates** — the
 *     slice stays `requires-attention` (marked with {@link ESCALATION_MARKER}) and {@link readyFrontier}
 *     stops dispatching it, so a human decides;
 *   • SP-6/9 — a `contract` fault **escalates** too, but to a contract re-cut (marked with
 *     {@link CONTRACT_DEFECT_MARKER}, `route: "contract"`) and WITHOUT burning an attempt: `attempts`
 *     stays === `priorAttempts`, regardless of the prior count or bound, because the slice was never
 *     the problem — the contract is.
 *
 * No model is consulted here — the bound and the route are control-plane, the deterministic analog of
 * "stop retrying after N"; the code-vs-test `fault` is the only model input and it is supplied by the
 * injectable {@link JudgeFailure}, never computed in this pure function.
 */
export function reDispatchDecision(
  priorAttempts: number,
  bound: number = MAX_REWORK_ATTEMPTS,
  fault?: Fault,
): ReDispatchVerdict {
  const prior = Number.isFinite(priorAttempts)
    ? Math.max(0, Math.floor(priorAttempts))
    : 0;
  // SP-6/9 contract arm: a contract-attributed fault escalates to a contract re-cut REGARDLESS of the
  // prior count / bound, and — unlike every other path — does NOT burn a rework attempt: the slice was
  // never the problem, so `attempts` stays === the prior count (not prior + 1). `readyFrontier` holds
  // the slice until the contract changes; the shell stamps the CONTRACT_DEFECT_MARKER, not ESCALATION.
  if (fault === "contract") {
    return { action: "escalate", attempts: prior, route: "contract" };
  }
  const attempts = prior + 1;
  // Escalate at the bound OR when the fault is ambiguous (both code and test suspect) — AC4.
  const escalate = isEscalated(attempts, bound) || fault === "both";
  const verdict: ReDispatchVerdict = {
    action: escalate ? "escalate" : "re-dispatch",
    attempts,
  };
  if (fault) verdict.route = fault;
  return verdict;
}

/**
 * Does a slice body / diagnosis already carry the {@link ESCALATION_MARKER} (SP-6/6 AC5)? The shell
 * reads this on a reloaded slice to know the bounded loop already gave up, so it never re-seeds the
 * slice into the ready frontier. Pure.
 */
export function hasEscalationMarker(body: string): boolean {
  return (body ?? "").includes(ESCALATION_MARKER);
}

/**
 * Stamp the {@link ESCALATION_MARKER} onto a requires-attention diagnosis/body (SP-6/6 AC5), idempotently
 * — a body that already carries the marker is returned unchanged, so a re-run can't accumulate duplicate
 * markers. The marker is appended on its own line (the durable, human-facing signal that the bounded
 * rework loop has been exhausted and a human decision is required). Pure.
 */
export function markEscalated(body: string): string {
  const text = body ?? "";
  if (hasEscalationMarker(text)) return text;
  return text.trim()
    ? `${text.replace(/\s+$/, "")}\n\n${ESCALATION_MARKER}`
    : ESCALATION_MARKER;
}

/**
 * Strip the `## Acceptance Criteria` block — the heading PLUS its body, up to the next heading of
 * the same or higher level — from a Spec/slice markdown body (SP-6 AC1, "hold out the exam"). The
 * worker builds to **intent** (summary / Design / its task) and never receives the gradeable
 * criteria it would otherwise be tempted to optimise to. Pure + idempotent: a body with no AC block
 * passes through unchanged. Heading + AC-title matching mirrors `checkAcOrdinals` so the exact
 * section the grader later ticks is the section withheld here.
 */
export function stripAcceptanceCriteria(body: string): string {
  const lines = (body ?? "").split(/\r?\n/);
  const out: string[] = [];
  let skipLevel: number | null = null; // the AC heading's level while we're dropping its block
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      // Inside the AC block: a heading of the same/higher level ends it; a deeper sub-heading
      // belongs to the block and is dropped too.
      if (skipLevel !== null) {
        if (level <= skipLevel) skipLevel = null;
        else continue;
      }
      const text = heading[2].trim().toLowerCase();
      if (
        skipLevel === null &&
        (text === "acceptance criteria" || text === "acceptance_criteria")
      ) {
        skipLevel = level;
        continue;
      }
    } else if (skipLevel !== null) {
      continue; // body line inside the AC block — drop it.
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Strip a `satisfies:` frontmatter key — and any YAML block-list items nested under it — from a
 * slice/spec body (SP-6 AC1). The slice keeps `satisfies` orchestrator-internally for the grader;
 * what's removed here is only the embedding the worker would read, so the implementer can't learn
 * which AC ordinals it is graded against. Targets the structured key (`^…satisfies:`) ONLY — a
 * prose mention of the word "satisfies" is never touched. Pure + idempotent.
 */
export function stripSatisfies(body: string): string {
  const lines = (body ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)satisfies\s*:(.*)$/i.exec(lines[i]);
    if (m) {
      const indent = m[1].length;
      // Block-list form (`satisfies:` with an empty value) → also drop the deeper `- …` items.
      if (m[2].trim() === "") {
        while (i + 1 < lines.length) {
          const next = lines[i + 1];
          const ni = (/^(\s*)/.exec(next)?.[1] ?? "").length;
          if (ni > indent && /^\s*-\s/.test(next)) i++;
          else break;
        }
      }
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/**
 * Build the **autonomy-first prompt** for a worker dispatched on one execution unit
 * (SP-tgs8nz). Scoped to the unit's footprint + shape, it tells the worker to decide
 * autonomously (never seek confirmation), never touch git or the thinking space, and escalate
 * with a question ONLY when genuinely blocked — the posture that keeps headless
 * execution from stopping on routine approvals.
 *
 * **Intent view, exam held out (SP-6 AC1) — and its inverse for a test unit (SP-6/7 AC1):** for a
 * `code` unit the embedded spec/slice is the *intent* (summary, Design, the unit's task + footprint)
 * with the `## Acceptance Criteria` block and any `satisfies` ordinals **stripped**
 * ({@link stripAcceptanceCriteria} / {@link stripSatisfies}) — the code-author builds to what
 * "correct" means, never to the rubric it is graded on. A `test` unit ({@link SchedUnit.role} ===
 * `"test"`) is the **held-out verifier**: the SAME strip is **inverted** — the ACs + `satisfies` are
 * KEPT so its probe (under the reserved `acceptance/` path) can grade the exact criteria, black-box.
 * Pure → unit-tested.
 */
/**
 * Tools DENIED to a worker by role (SP-6/7). Independence is STRUCTURAL — a `role: test` worker's
 * cwd is the Spec's TESTER worktree, a base-commit snapshot where the code workers' in-progress
 * modifications simply do not exist — so its Read/Glob are unrestricted (there is nothing to hide in
 * its tree; it needs the base code to write a well-integrated test). The tool denial is the
 * SECONDARY control (the maintainer's layering: inform → structure → fence):
 *   • **Bash** — the roam vector (`cd` into the code worktree / other repos / session transcripts):
 *     an arbitrary shell command is NOT lexically containable, so it stays denied;
 *   • **WebFetch / WebSearch / Task** — no need, and Task could spawn an unfenced sub-agent.
 * SP-6/16 Part B: **Grep** is no longer denied wholesale — a pathless/absolute-path search was its only
 * escape route, and that is now closed LEXICALLY by {@link grepWithinCwd} (scoping the search to the
 * worker's own cwd snapshot) rather than by removing the tool. In-tree search is fair use (the tester
 * only ever reads within its own snapshot), so `Grep` is restored as an available tool + cwd guard.
 * A `code` worker keeps unrestricted `Grep` (it already has `Bash`, so scoping its `Grep` buys nothing;
 * its footprint fence stops it authoring the `acceptance/` grader, and `codeReadFence` stops it reading
 * copied-in probes during rework). Pure → the caller passes the result as the SDK query's `disallowedTools`.
 */
export function disallowedToolsForRole(role?: "code" | "test"): string[] {
  return role === "test" ? ["Bash", "WebFetch", "WebSearch", "Task"] : [];
}

/**
 * SP-6/16 Part B — the PURE, lexical cwd-containment guard for a `role: test` worker's `Grep` (the
 * tool un-denied above). A tester's `cwd` is its base-commit snapshot worktree, a sibling of the code
 * worktree where the graded implementation lives; the original blanket deny existed only to stop a
 * pathless / absolute-path search reaching that sibling. This restores in-tree search while closing
 * exactly that escape: a `Grep` whose `path` argument is absolute or `..`-escapes `cwd` is DENIED; an
 * omitted path (searches cwd) or a path that resolves within cwd is ALLOWED; a non-`Grep` tool is
 * always allowed (this guard governs `Grep` only). Purely lexical — `path.resolve`/`path.relative`
 * against `cwd`, the SAME rule as {@link sliceFilesResolveInRepo}; no `realpath`/`fs` (the low-likelihood
 * symlink-escape gap is accepted, out of scope). The caller applies this in the PreToolUse hook only
 * when `isTest`, returning the same `permissionDecision: "deny"` shape on `{ allow: false }`.
 */
export function grepWithinCwd(
  toolName: string,
  toolInput: unknown,
  cwd: string,
): { allow: true } | { allow: false; reason: string } {
  // This guard governs Grep only — any other tool is outside its remit.
  if (toolName !== "Grep") return { allow: true };
  const rawPath = (toolInput as { path?: unknown } | null | undefined)?.path;
  // No `path` (or a blank one) → the Grep searches cwd itself → contained → allowed.
  if (rawPath == null || (typeof rawPath === "string" && !rawPath.trim())) {
    return { allow: true };
  }
  // A non-string path can't be reasoned about lexically — deny fail-safe.
  if (typeof rawPath !== "string") {
    return {
      allow: false,
      reason: `Grep path must be a string inside the working directory; got ${typeof rawPath}.`,
    };
  }
  const root = path.resolve(cwd);
  const target = rawPath.trim();
  // Absolute paths are denied even if they happen to point inside — mirrors sliceFilesResolveInRepo:
  // the search must be declared relative to the worker's snapshot, never as an absolute checkout path.
  if (path.isAbsolute(target)) {
    return {
      allow: false,
      reason: `Grep path must stay inside the working directory (${root}); absolute paths are denied: ${rawPath}`,
    };
  }
  // Resolve against cwd and require it to stay under root. `path.relative` yields a leading `..` (or an
  // absolute path on a drive change) when the target escapes; `""` means the path IS cwd — allowed for a
  // search (unlike a slice footprint, cwd is a searchable directory).
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return {
      allow: false,
      reason: `Grep path escapes the working directory (${root}): ${rawPath}`,
    };
  }
  return { allow: true };
}

export function buildWorkerPrompt(
  unit: SchedUnit,
  specNumber: string,
  context?: {
    specBody?: string;
    sliceBody?: string;
    testConvention?: string;
    /** SP-12: the repo-declared, non-mutating build-and-test command a CODE-author runs to
     *  self-verify (read from `.tandem/conventions.json`'s top-level `selfVerify`). Rendered as the
     *  VERIFICATION BLOCK for code units when set; omitted entirely (block + `SELF-VERIFY` marker)
     *  when absent/blank. A test unit renders none of the SP-12 blocks. Ignored when
     *  {@link oracleAvailable} is set — the oracle replaces the self-run command. */
    selfVerifyCommand?: string;
    /** Tests-first (2026-07-08): the black-box verify oracle is wired for this code unit. The
     *  VERIFICATION BLOCK then instructs the worker to verify EXCLUSIVELY via the `verify` tool
     *  (never running builds/tests itself), and the prohibitions extend to every test file. */
    oracleAvailable?: boolean;
    /** SP-6/16 Part A: the repo's canonical example test CONTENT — the file declared as a repo-relative
     *  `testExample` in `.tandem/conventions.json`, its content read by `defaultAcceptanceRecipeResolver`.
     *  Rendered VERBATIM under the `EXAMPLE TEST` marker into a `role: "test"` prompt ONLY; omitted
     *  entirely (block + marker) when absent/blank, and NEVER rendered for a code unit. */
    exampleTest?: string;
  },
): string {
  const fp = unit.footprint.join(", ") || "(no declared footprint)";
  // Files a sibling unit produces that THIS unit reads — the contract-first dependency.
  // Surface it structurally (not just buried in the prose note): the worker must IMPORT the
  // sibling's contract for these files, never re-invent it (the prose-pinning the gate replaces).
  const consumes = [
    ...new Set(
      (unit.units ?? []).flatMap(
        (u) => (u as WorkUnit & { consumes?: string[] }).consumes ?? [],
      ),
    ),
  ];
  const consumesBlock =
    consumes.length > 0
      ? `\nContract dependency: this unit CONSUMES ${consumes.join(", ")} — a sibling unit produces ${consumes.length > 1 ? "these files" : "this file"}. Import ${consumes.length > 1 ? "their" : "its"} contract (types/exports/shape); do NOT re-invent it. If ${consumes.length > 1 ? "they don't exist" : "it doesn't exist"} yet, code to the contract the spec/slice describes.\n`
      : "";
  const isTest = (unit.role ?? "code") === "test";
  // SP-6/7: a `test` unit's task is framed NEUTRALLY — "write tests asserting these behaviours
  // against this interface." It is deliberately NOT told it is a held-out verifier, that a code-author
  // exists, that ACs were stripped from anyone, or that a fence exists: an unaware worker can't reason
  // about or game the independence boundary. Its independence is STRUCTURAL — its cwd is a base-commit
  // snapshot that simply does not contain the in-progress implementation — so it writes its test from
  // the snapshot's base code + the injected contract + criteria + test convention.
  const task = isTest
    ? `Write automated test(s) at [${fp}]${unit.note ? ` that assert: ${unit.note.replace(/\s*\.?\s*$/, "")}` : " asserting the behaviours in the Acceptance criteria below"}. Exercise ONLY the public interface in the SPEC CONTRACT below (write to that interface — do not assume any particular internal implementation).`
    : unit.shape === "mechanize"
      ? `This is a MECHANIZE unit: author ONE transform and apply it across all of [${fp}] — do not hand-edit each object.`
      : unit.shape === "fan-out"
        ? `This is a FAN-OUT unit over [${fp}].${unit.note ? ` Task: ${unit.note}` : ""}`
        : `This is a SERIAL unit — do its steps in order over [${fp}].${unit.note ? ` Task: ${unit.note}` : ""}`;
  // The test convention (framework + how the file is run), injected so a test unit — which has no
  // Bash to poke the toolchain — can author a runnable test straight from its prompt (SP-6/7).
  const conventionBlock =
    isTest && context?.testConvention?.trim()
      ? `\nTest convention: ${context.testConvention.trim()}\n`
      : "";
  // SP-6/16 Part A — the repo's CANONICAL EXAMPLE TEST, injected so a test unit writes its probe
  // straight from prompt + contract instead of independently rediscovering the repo's test idiom
  // (reading whole files to reverse-engineer the fixture/assertion pattern). Rendered VERBATIM under a
  // distinct `EXAMPLE TEST` marker for test units ONLY; omitted entirely (block + marker) when
  // exampleTest is absent/blank, and NEVER rendered for a code unit. Independent of `conventionBlock`
  // above (that carries the framework + run hint; this carries the idiom to mirror).
  const exampleBlock =
    isTest && context?.exampleTest?.trim()
      ? `\n──── EXAMPLE TEST (the repo's canonical test idiom — mirror its structure / fixtures / assertions; do NOT reuse its subject) ────\n${context.exampleTest}\n`
      : "";
  // SP-6/7 — the tester's workspace, stated PLAINLY (inform first): ONE directory — its cwd is a
  // snapshot of the codebase taken before this feature's changes (structural independence: the
  // in-progress implementation is not in its tree, so there's no read-here/write-there split to
  // confuse and nothing to fence). Modules named in the contract may not exist yet — expected.
  const workspaceBlock = isTest
    ? `\nYour working directory is a SNAPSHOT of the codebase taken before this feature's changes. Read anything here you need — the test harness, helpers, existing tests, import/type conventions — and write your test file(s) at your footprint (${fp}) using paths relative to the working directory. The modules named in the SPEC CONTRACT may not exist in this snapshot yet (the feature is being built); that's expected — import them by the exact path/name the contract gives and write your tests against the contract + the criteria below. They resolve when the feature is assembled.\n`
    : "";
  // SP-6/3: the Spec-wide design-time CONTRACT — the shared interface (union of every slice's
  // declared contract) every unit (code AND held-out test, in ANY slice) builds against. Injected
  // verbatim into EVERY unit's prompt so they agree on the exact seam (exports/types/signatures/
  // behaviour) WITHOUT reading each other's code — including a seam another slice owns. This is the
  // cross-slice interface agreement `consumes` used to carry, now pinned up front.
  const contractBlock = unit.contract?.trim()
    ? `\n──── SPEC CONTRACT (the shared interface across the whole feature — implement and verify EXACTLY against this; do not rename, widen, or invent) ────\n${unit.contract.trim()}\n`
    : "";
  // SP-12: a CODE unit carries the repo's sanctioned self-verify command PLUS two standing
  // prohibitions, stated up front so the worker never has to improvise into shared build config or
  // touch the held-out probes to figure out how to run tests. (A `test` unit renders NONE of these —
  // it is the held-out verifier and already gets the `acceptance/` footprint + convention.)
  //  1. VERIFICATION BLOCK — only when a self-verify command is supplied: the exact, non-mutating
  //     build-and-test invocation, verbatim, under a distinct `SELF-VERIFY` marker so its absence is
  //     grep-checkable. Omitted ENTIRELY (block + marker) when no command is declared.
  //  2. FOOTPRINT PROHIBITION (unconditional) — files outside the declared footprint, shared
  //     build/config (`tsconfig*.json`, etc.) included, are off-limits; the guard reverts a breach.
  //  3. HELD-OUT PROHIBITION (unconditional) — the held-out `acceptance/` probes are the closing
  //     gate's to grade; the worker must not build or run them.
  const selfVerify = context?.selfVerifyCommand?.trim();
  const oracle = !isTest && !!context?.oracleAvailable;
  // Tests-first (2026-07-08): with the oracle wired, the coder's ONLY feedback channel is the
  // `verify` tool — it compiles the current work together with the slice's acceptance checks in
  // an isolated runner and returns structured results (compile errors / per-check pass-fail).
  // The worker never builds or runs anything itself, so it needs no local toolchain and has no
  // reason to touch test files or shared build config.
  const verifyBlock = oracle
    ? `\n──── VERIFY (your only feedback channel) ────\nAfter editing, call the \`verify\` tool (mcp__oracle__verify). It builds your current work together with this slice's acceptance checks in an isolated runner and returns the results: compile errors, or per-check PASS/FAIL with the failing assertion. Iterate until everything passes. Do NOT run builds or tests yourself — the tool is faster and authoritative. A failure the tool marks as "not your code" is being handled elsewhere; keep implementing to the SPEC CONTRACT.\n`
    : !isTest && selfVerify
      ? `\n──── SELF-VERIFY (after editing your files, run this non-mutating build-and-test command to check your work) ────\n${selfVerify}\n`
      : "";
  const prohibitionsBlock = !isTest
    ? `\nSTANDING PROHIBITIONS (do not breach these to self-verify):\n` +
      `- Stay inside your declared footprint. Never edit a file outside it — shared build/config (\`tsconfig*.json\`, other tsconfig files, etc.) included. The footprint guard hard-aborts and reverts an out-of-footprint write; do not improvise into shared build config to make tests run.\n` +
      (oracle
        ? `- Test authorship is not your role: never create, edit, read or run ANY test file (\`*.test.*\`, anything under \`acceptance/\`). Verification happens ONLY through the \`verify\` tool.\n` +
          `- Never run package managers or build/test commands (\`npm install\`, \`npm test\`, \`tsc\`, …) — the worktree has no toolchain for you, by design; the \`verify\` tool is the whole feedback loop.\n`
        : `- The held-out \`acceptance/\` probes are graded by the closing gate, not by you: do not build or run them.\n`)
    : "";
  // The worker runs in a worktree of the CODE repo — the thinking space/specs dir is NOT there. Embed the
  // spec + slice so it has full context inline rather than hunting the filesystem for a spec it cannot
  // reach. SP-6 AC1 / SP-6/7 AC1: a `code` unit gets the INTENT VIEW only — the `## Acceptance Criteria`
  // block and any `satisfies` ordinals are STRIPPED so it builds to intent, never to the rubric it is
  // graded on; a `test` unit KEEPS them (the inverse) so its held-out probe can target the exact criteria.
  const viewOf = (body: string): string =>
    (isTest
      ? (body ?? "")
      : stripSatisfies(stripAcceptanceCriteria(body ?? ""))
    ).trim();
  const intentSpec = viewOf(context?.specBody ?? "");
  const intentSlice = viewOf(context?.sliceBody ?? "");
  const viewLabel = isTest ? "" : " — INTENT";
  const specBlock = intentSpec
    ? `\n──── PARENT SPEC (SP-${specNumber})${viewLabel} ────\n${intentSpec}\n`
    : "";
  const sliceBlock = intentSlice
    ? `\n──── YOUR SLICE (${unit.slice})${viewLabel} ────\n${intentSlice}\n`
    : "";
  const hasCtx = specBlock || sliceBlock;
  return (
    `You are an autonomous Tandem worker for execution unit ${unit.id} of slice ${unit.slice}.\n` +
    `Do only THIS unit's work — write only within its footprint: ${fp}.\n` +
    (hasCtx
      ? `The thinking space/specs dir is NOT in this worktree; your spec + slice are embedded below — use them, don't search the filesystem for specs/.\n`
      : `(Read the parent spec/slice for context if available — note the specs dir may not be in this worktree.)\n`) +
    `\n${task}\n` +
    contractBlock +
    verifyBlock +
    prohibitionsBlock +
    conventionBlock +
    exampleBlock +
    workspaceBlock +
    consumesBlock +
    specBlock +
    sliceBlock +
    `\nWork autonomously to the intent (goal / design / behaviour) described above — build what "correct" means here. Make reasonable engineering decisions and do NOT ask for confirmation. ` +
    `Do NOT commit, run git, or move the thinking space card — the orchestrator owns git and the gate. ` +
    // Terminate-on-denial (SP-6/7), redirect-aware: never BRUTE-FORCE a boundary (the drive to finish
    // is what turns a blocked worker into one grinding through Bash / alternate paths), but a denial
    // that redirects to a better source is followed, and only a genuine dead-end stops the worker.
    `\nIf the SYSTEM denies a tool call, do NOT brute-force around it — no retrying, no routing through another tool, no alternate path to defeat the constraint. If the denial's message points you to a better source or way of working, follow it and carry on. Only if you genuinely cannot proceed from the spec / slice / contract / codebase, output a single final message beginning with ${NEEDS_INPUT_SENTINEL} that quotes the blocker, then stop. ` +
    `Likewise, if you hit a genuine decision you cannot make from that context, output a single final message that begins with ${NEEDS_INPUT_SENTINEL} followed by your question, then stop — never guess, never brute-force a boundary.`
  );
}

/** The marker a blocked worker prepends to its question so the orchestrator can park it (SL-3). */
export const NEEDS_INPUT_SENTINEL = "⟦NEEDS-INPUT⟧";

/**
 * Pull a worker's escalated question out of its output (SL-3): the text after the
 * `⟦NEEDS-INPUT⟧` marker, or null if the worker never escalated. Pure.
 */
export function extractNeedsInput(text: string): string | null {
  const i = text.indexOf(NEEDS_INPUT_SENTINEL);
  if (i === -1) return null;
  return (
    text.slice(i + NEEDS_INPUT_SENTINEL.length).trim() || "(no question text)"
  );
}

/** The session id carried on a stream-json / SDK event, for resume-on-answer (SL-3/SL-5). */
export function sessionIdOf(evt: Record<string, unknown>): string | undefined {
  const s = evt.session_id;
  return typeof s === "string" && s ? s : undefined;
}

/**
 * Extract a failure diagnosis from a delivery report OR a slice body (SP-11/3, extending SP-tgs8nz
 * AC4). Matches the delivery report's plain-language `## What happened` prose FIRST; if that heading
 * is absent (or empty), falls back to the slice body's `## ⚑ Requires attention` heading — so the
 * existing `/attend` slice-diagnosis caller keeps working unchanged. Returns undefined when neither is
 * present. The attended-session divergence is `stripFailingCheck(extractDiagnosis(report))`.
 */
export function extractDiagnosis(body: string): string | undefined {
  const text = body ?? "";
  // Consume ONLY the heading's own line-break (not the blank separator) so an EMPTY What-happened
  // section captures "" and correctly falls through to the ⚑ heading below.
  const wh = /##\s*What happened[ \t]*\r?\n([\s\S]*?)(?:\r?\n##\s|$)/.exec(
    text,
  );
  if (wh?.[1]?.trim()) return wh[1].trim();
  const m = /##\s*⚑\s*Requires attention\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(
    text,
  );
  return m?.[1]?.trim() || undefined;
}

/**
 * Extract a worker's out-of-scope findings (SP-11/3) — the list items / paragraphs under a **trailing**
 * `## Discoveries` heading of its final output — with list markers stripped and each line trimmed.
 * `"## Discoveries\n- a\n- b"` → `["a","b"]`; the heading absent ⇒ `[]`. The convention is declared
 * (the discovery channel): the orchestrator pairs each returned item with its unit id and feeds them —
 * verbatim, no model-side summarizing — into the report's `## Discoveries & recommendations`. Pure.
 */
export function extractDiscoveries(finalOutput: string): string[] {
  const text = finalOutput ?? "";
  // The TRAILING `## Discoveries` heading — take the last one if a body repeats it.
  const re = /^##\s+Discoveries\s*$/gim;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) start = m.index + m[0].length;
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of text.slice(start).split(/\r?\n/)) {
    if (/^\s*#{1,6}\s+/.test(line)) break; // the next heading ends the section
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    if (stripped) items.push(stripped);
  }
  return items;
}

/**
 * The fault-test rework context seam (SP-11/3): the ONLY deliberate exception to the redaction
 * boundary. When a failed acceptance run is judged `route === "test"` — the held-out probe itself is
 * broken and the TEST author owns the check — the test re-author gets the judge's diagnosis of the
 * mechanism VERBATIM (redacting a broken check's mechanism from the person rewriting the check caused
 * two identical false-red rounds on SP-11/2). For any other route (`code` / undefined) this returns
 * undefined: code authors stay fully redacted (SP-6/9 behaviour unchanged). `OrchestratorService`
 * feeds the result into the `role: "test"` re-author's prompt ONLY. Pure.
 */
export function buildTestReworkContext(
  diagnosis: string,
  route: "code" | "test" | undefined,
): string | undefined {
  return route === "test" ? diagnosis : undefined;
}

/**
 * Strip the **failing-check specifics** from a rework-feedback string (SP-6 AC3) so the fixer is
 * steered by *what behaviour diverged from the intent*, never by "make assertion X pass." It
 * defensively removes the three channels the closing gate's evidence leaks through:
 *
 *   • the failing **AC ordinal** — `AC #3`, `AC 3`, a bare `#4`;
 *   • the failing **run command** — a `$ <cmd> → exit N` / `$ …` shell line (the `acEvidence` shape);
 *   • **its output** — fenced ``` /``~~~`` evidence blocks and `| … |` per-AC table rows (the
 *     `DELIVERY.md` per-AC table), plus leftover `→ exit N` / `→ could not run …` result fragments.
 *
 * A clean, prose intent-divergence description (no `$`/fence/table/ordinal tokens) passes through
 * essentially unchanged. Pure + idempotent. The rework-prompt builders route their feedback through
 * this as belt-and-braces — on top of only ever being *handed* a divergence description rather than
 * the AC results or the delivery report — so the omission holds even if a caller passes raw evidence.
 */
export function stripFailingCheck(text: string): string {
  const lines = (text ?? "").split(/\r?\n/);
  const kept: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence; // drop the fence delimiters AND the command output they wrap
      continue;
    }
    if (inFence) continue;
    if (/^\s*\$\s/.test(line)) continue; // a `$ <cmd> → exit N` shell command line
    if (/^\s*\|/.test(line)) continue; // a `| AC | Verified by | … |` per-AC evidence table row
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\bAC[\s_]*#?\s*\d+/gi, "") // "AC #3" / "AC 3" → drop the ordinal
    .replace(/#\d+\b/g, "") // a bare `#4` ordinal
    .replace(/→\s*(?:exit\s+-?\d+|could not run[^\n]*)/gi, "") // leftover run-result fragments
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The chat prefill priming an `/attend` session (SP-11/2 + SP-6 AC3): the `/attend` skill invocation
 * for the requires-attention slice, followed — when a divergence is supplied — by an
 * **intent-divergence** description of how the behaviour diverged from what was intended. The
 * divergence is routed through {@link stripFailingCheck}, so the fixer never sees the failing AC
 * ordinal, the failing `run` command, or its output and so cannot optimise "make assertion X pass."
 * A no-`divergence` call is just the bare `/attend <handle>` invocation, with no dangling label. The
 * `/attend` skill (TEP-11/SP-1) supplies the "re-read the intent, bring the behaviour back, return to
 * Ready" workflow — this prefill no longer duplicates that prose. Pure.
 */
export function buildAttendPrompt(handle: string, divergence?: string): string {
  return (
    `/attend ${handle}` +
    (divergence ? `\n\n${stripFailingCheck(divergence)}` : "")
  );
}

/**
 * The chat prefill priming a Spec-level `/attend` session (SP-11/2 + SP-6 AC3) — the spec-level
 * analog of {@link buildAttendPrompt}, hosted here so the rework/divergence builders live in one
 * pure place (reuse, don't fork). It is the `/attend SP-<specId>` skill invocation, followed —
 * when the Spec lives on a cross-repo project thinking space — by the thinking-space note so every
 * kanban call addresses it explicitly, then — when a divergence is supplied — by an
 * **intent-divergence** description routed through {@link stripFailingCheck} (NOT the `DELIVERY.md`
 * per-AC table, its `run` commands, or their output), so the reworking worker is steered by the
 * intent and never by the failing AC ordinal, the failing command, or its output. No divergence ⇒
 * no trailing paragraph. The `/attend` skill (TEP-11/SP-1) supplies the rework workflow. Pure.
 */
export function buildRejectPrompt(
  specId: string,
  divergence?: string,
  projectThinkingSpaceId?: string,
): string {
  // For a cross-repo project member the Spec lives on the project thinking space, NOT on this
  // worktree's repo thinking space — so every kanban call must address it explicitly.
  const thinkingSpaceNote = projectThinkingSpaceId
    ? `\n\nIMPORTANT — this Spec lives on the project thinking space \`${projectThinkingSpaceId}\`, not on this worktree's repo. Pass \`thinking_space=${projectThinkingSpaceId}\` to EVERY kanban tool (get_thinkube_file / get_slice / list_thinking_space / move_slice / patch_spec_section / write_spec / create_slice). Your cwd's thinking space is the working repo where the code lives, which is NOT this Spec's thinking space.`
    : "";
  const divergenceNote = divergence
    ? `\n\n${stripFailingCheck(divergence)}`
    : "";
  return `/attend SP-${specId}` + thinkingSpaceNote + divergenceNote;
}

/**
 * Line-buffered NDJSON parser for a worker's persisted `.jsonl` session log. Feed raw stdout
 * chunks; returns the parsed objects for every **complete** line so far, holding a trailing
 * partial line until the next chunk. Blank and unparseable lines are skipped (never throws).
 */
export class StreamJsonBuffer {
  private buf = "";

  push(chunk: string): Record<string, unknown>[] {
    this.buf += chunk;
    const out: Record<string, unknown>[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const obj: unknown = JSON.parse(line);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          out.push(obj as Record<string, unknown>);
        }
      } catch {
        /* non-JSON line (e.g. a stray log) — skip */
      }
    }
    return out;
  }
}

/**
 * Summarize a stream-json event into a one-line session-log string, or null to skip.
 * Event shapes verified against claude v2.1.178: system/init, assistant (text + tool_use),
 * result.
 */
const clip = (x: string, n: number): string =>
  x.length > n ? x.slice(0, n - 1) + "…" : x;

/** A readable one-liner for a tool_use — name PLUS the part that matters (the command, file,
 *  pattern, query), so the log is debuggable instead of a column of bare `▸ Bash`. */
export function toolUseSummary(name: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case "Bash":
      return `▸ $ ${clip(str(inp.command).replace(/\s+/g, " "), 160)}`;
    case "Read":
      return `▸ Read ${str(inp.file_path)}`;
    case "Write":
      return `▸ Write ${str(inp.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `▸ Edit ${str(inp.file_path)}`;
    case "Glob":
      return `▸ Glob ${str(inp.pattern)}`;
    case "Grep":
      return `▸ Grep ${str(inp.pattern)}${inp.path ? ` in ${str(inp.path)}` : ""}`;
    case "ToolSearch":
      return `▸ ToolSearch ${clip(str(inp.query), 80)}`;
    default: {
      let j = "";
      try {
        j = JSON.stringify(inp);
      } catch {
        /* unserializable */
      }
      return `▸ ${name}${j && j !== "{}" ? ` ${clip(j, 120)}` : ""}`;
    }
  }
}

/** The first non-empty line of a tool_result, indented under its call (✗ when it errored). */
export function toolResultSummary(
  block: Record<string, unknown>,
): string | null {
  let text = "";
  if (typeof block.content === "string") text = block.content;
  else if (Array.isArray(block.content))
    text = (block.content as Array<Record<string, unknown>>)
      .filter((x) => x.type === "text" && typeof x.text === "string")
      .map((x) => x.text as string)
      .join(" ");
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return null;
  return `   ${block.is_error === true ? "✗" : "⤷"} ${clip(first, 160)}`;
}

/**
 * Summarize a session-log event into one or more lines (newline-joined), or null to skip.
 * Renders assistant text + tool_use (with its input), tool_result snippets, and the final result.
 */
export function summarizeEvent(evt: Record<string, unknown>): string | null {
  if (evt.type === "system" && evt.subtype === "init")
    return "▸ session started";
  if (evt.type === "assistant") {
    const msg = evt.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const parts: string[] = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim())
        parts.push(b.text.trim());
      if (b.type === "tool_use" && typeof b.name === "string")
        parts.push(toolUseSummary(b.name, b.input));
    }
    return parts.length ? parts.join("\n") : null;
  }
  if (evt.type === "user") {
    const msg = evt.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const parts: string[] = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === "tool_result") {
        const s = toolResultSummary(b);
        if (s) parts.push(s);
      }
    }
    return parts.length ? parts.join("\n") : null;
  }
  if (evt.type === "result") {
    return isResultSuccess(evt)
      ? "✓ result: success"
      : `✗ result: ${String(evt.subtype ?? "error")}`;
  }
  return null;
}

/** Did a parsed stream-json `result` event report success? */
export function isResultSuccess(evt: Record<string, unknown>): boolean {
  return (
    evt.type === "result" && evt.is_error !== true && evt.subtype === "success"
  );
}

// ── Closing AI-verification gate (SP-tgzyfy / TEP-tgzx3p) ──────────────────
//
// At Spec quiescence the orchestrator runs the Spec's DECLARED per-AC verifications as a
// complete plan against the worktree (the live cluster for infra) and gates Done/commit on
// all-green. No skip: a Spec whose declared checks can't all run is requires-attention, never
// silently Done (this reverses today's `defaultVerify` skip-pass). The declaration lives in the
// Spec frontmatter as `ac_verifications` (AC ordinal → { run, env }); the result maps each
// pass/fail back to the AC(s) it proves and feeds the auditable per-AC report.

/** One AC's declared verification — how AC #`ac` is proven (the closing gate's input). */
export interface AcVerification {
  /** 1-based AC ordinal this check proves. */
  ac: number;
  /** The shell/playbook command run in the worktree (exit 0 = the AC passed). Empty for an
   *  `assessment` AC (SP-6/7 AC3) — that AC is graded by an independent assessor, not a command. */
  run: string;
  /** Where it runs — informational for `cluster`/`local` (the live cluster run is the shell's job).
   *  `assessment` (SP-6/7 AC3) is the model-graded branch: the closing gate dispatches a fresh
   *  independent assessor session (never the implementing worker) instead of spawning `run`. */
  env?: "cluster" | "local" | "assessment";
}

/** The outcome of running one AC's verification — pass/fail with its evidence (log excerpt). */
export interface AcResult {
  /** 1-based AC ordinal this result proves. */
  ac: number;
  pass: boolean;
  /** The command + exit code + a tail of its output (or the un-runnable reason). Auditable. */
  evidence: string;
}

/**
 * Normalize the Spec frontmatter `ac_verifications` map (AC ordinal → { run, env }) into the
 * ordered `AcVerification[]` the runner executes. Tolerant: keys parse from string or number,
 * non-positive / non-integer ordinals and entries without a non-empty `run` are dropped; the
 * result is sorted by ordinal so the plan runs in a stable, dependency-friendly order.
 */
export function parseAcVerifications(raw: unknown): AcVerification[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: AcVerification[] = [];
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const ac = Number(key);
    if (!Number.isInteger(ac) || ac <= 0) continue;
    if (!val || typeof val !== "object") continue;
    const run = (val as Record<string, unknown>).run;
    const env = (val as Record<string, unknown>).env;
    const isAssessment = env === "assessment";
    // An `assessment` AC (SP-6/7 AC3) is graded by an independent assessor session, not a runnable
    // command — so it needs no non-empty `run`. Every other AC still requires a runnable command.
    if (!isAssessment && (typeof run !== "string" || !run.trim())) continue;
    out.push({
      ac,
      run: typeof run === "string" ? run.trim() : "",
      env:
        env === "cluster" || env === "local" || env === "assessment"
          ? env
          : undefined,
    });
  }
  return out.sort((a, b) => a.ac - b.ac);
}

/** Run one declared command in `cwd`, resolving its exit code + combined output. Injectable so
 *  the runner is unit-testable; the default spawns a shell (the real cluster/local run). */
export type AcExec = (
  run: string,
  cwd: string,
) => Promise<{ code: number | null; output: string }>;

/** The independent-assessor verdict for an `env: "assessment"` AC (SP-6/7 AC3): pass/fail plus the
 *  assessor's **rationale** (why), so the verdict is recordable in the verification trace. */
export interface AcAssessment {
  pass: boolean;
  rationale: string;
}

/**
 * Grade one `assessment` AC (SP-6/7 AC3) by dispatching a **fresh independent assessor** (never the
 * implementing worker): judge the delivered `artifact` against the AC + its `intent` and return
 * pass/fail **with a rationale** — no runnable command required. Injectable so the closing gate is
 * unit-testable with no live model; the real SDK-session dispatch lives in `OrchestratorService`.
 */
export type AssessAc = (
  ac: AcVerification,
  intent: string,
  artifact: string,
) => Promise<AcAssessment>;

/** What {@link runAcVerifications} needs to grade an `assessment` AC (SP-6/7 AC3): the injectable
 *  assessor plus the per-AC intent (the criterion text / Spec intent) and a description of the
 *  delivered artifact the assessor judges. */
export interface AssessContext {
  assessAc: AssessAc;
  /** The intent handed to the assessor for AC #`ac` — its criterion text + surrounding Spec intent. */
  intentFor?: (ac: number) => string;
  /** A description of the delivered artifact (changed files / diff summary) the assessor judges. */
  artifact?: string;
}

/** Knobs for {@link runBounded}: the time bound + a fixed base env (no ambient PATH leaks in). */
export interface BoundedOptions {
  /** Hard wall-clock bound (ms). On expiry the child's whole process group is killed. */
  timeoutMs: number;
  /**
   * The FIXED base environment handed to the child — runBounded never folds in `process.env`
   * wholesale. `env.PATH` is the scrubbed base PATH onto which `${cwd}/node_modules/.bin` is
   * prepended; everything else (other than the always-injected `GIT_TERMINAL_PROMPT`) passes
   * through verbatim. Pass `process.env` explicitly if you want the ambient env.
   */
  env: NodeJS.ProcessEnv;
  /** Grace between SIGTERM and the SIGKILL backstop (ms). Default 250. */
  killGraceMs?: number;
}

/** Exit code we resolve with when a bounded run is killed for exceeding its `timeoutMs`. */
export const TIMED_OUT_CODE = 124;
/** Marker appended to a timed-out run's output (and matched by the closing-gate report). */
export const TIMED_OUT_MARKER = "[timed out]";
/** Default bound for an unparameterized AC verification: generous (~10 minutes), per-AC overridable. */
export const DEFAULT_AC_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Linux process-group membership via `/proc`: the pids whose process-group id (field 5 of
 * `/proc/<pid>/stat`) equals `leaderPid`, EXCLUDING the leader itself. The shell spawned with
 * `detached:true` is its own group leader (pgid == pid), so its whole descendant tree shares that
 * pgid — these are the grandchildren we must reap. Returns `[]` where `/proc` is unavailable
 * (non-Linux); callers then fall back to the group `kill(-pid, …)` path. Never throws.
 */
function groupDescendants(leaderPid: number): number[] {
  const out: number[] = [];
  let names: string[];
  try {
    names = fs.readdirSync("/proc");
  } catch {
    return out; // no /proc (non-Linux) — caller falls back to group kill.
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === leaderPid) continue;
    let stat: string;
    try {
      stat = fs.readFileSync(`/proc/${name}/stat`, "utf8");
    } catch {
      continue; // process vanished mid-scan — fine.
    }
    // `pid (comm) state ppid pgrp …` — comm can contain spaces/parens, so split AFTER the last ')'.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[2]) === leaderPid) out.push(pid); // fields[2] == pgrp
  }
  return out;
}

/**
 * Run `run` in `cwd` as a bounded, non-interactive shell child (finding #12/#13/#7):
 *
 *  - **detached** → the child leads its own process group, so a timeout kill reaches the WHOLE tree:
 *    a backgrounded grandchild (`sh -c 'sleep & wait'`) can't orphan.
 *  - **stdin = /dev/null** (`stdio: ['ignore', …]`) → any read sees immediate EOF; nothing can wedge
 *    waiting for interactive input.
 *  - **env** = the fixed base `opts.env` + `GIT_TERMINAL_PROMPT=0` (git never prompts) + a PATH with
 *    `${cwd}/node_modules/.bin` prepended onto `opts.env.PATH` (repo-local toolchain wins; no ambient
 *    PATH is folded in — only what the caller put in the base env).
 *  - **on timeout** → signal the grandchildren (`groupDescendants`) FIRST so the shell leader's
 *    `wait` reaps them and then exits (node reaps the leader) — this frees their pids even on hosts
 *    whose PID 1 doesn't reap orphans. A `kill(-pid, 'SIGKILL')` group backstop after `killGraceMs`
 *    catches a leader/straggler that ignores SIGTERM. Resolves `{ code: 124, output: … + '[timed
 *    out]' }`. No wall-clock is reported — only the verdict.
 *
 * Resolves with the child's exit `code` + combined stdout/stderr; rejects only if the shell itself
 * can't be spawned (a not-found *command* surfaces as a non-zero shell exit, not a reject).
 */
export function runBounded(
  run: string,
  cwd: string,
  opts: BoundedOptions,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const base = opts.env ?? {};
    const localBin = path.join(cwd, "node_modules", ".bin");
    const childPath = base.PATH
      ? `${localBin}${path.delimiter}${base.PATH}`
      : localBin;
    const env: NodeJS.ProcessEnv = {
      ...base,
      GIT_TERMINAL_PROMPT: "0",
      PATH: childPath,
    };

    const proc = spawn(run, {
      cwd,
      shell: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let output = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const signal = (pid: number, sig: NodeJS.Signals): void => {
      try {
        process.kill(pid, sig);
      } catch {
        // already gone — nothing to do.
      }
    };

    const settle = (result: { code: number | null; output: string }): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    proc.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });
    proc.on("close", (code) => settle({ code, output }));

    killTimer = setTimeout(() => {
      const pid = proc.pid;
      if (typeof pid === "number") {
        // Reap grandchildren via the shell leader: SIGTERM the descendants so the leader's `wait`
        // returns and reaps them, then the leader exits on its own and node reaps it. This frees
        // the pids even where PID 1 doesn't reap orphans (so the group is *truly* gone, not zombied).
        for (const child of groupDescendants(pid)) signal(child, "SIGTERM");
        // Backstop: SIGKILL the whole group (covers a no-descendant leader and any SIGTERM-ignorer).
        // unref'd so the timer can't keep the event loop alive after we've resolved.
        setTimeout(() => {
          for (const child of groupDescendants(pid)) signal(child, "SIGKILL");
          signal(-pid, "SIGKILL"); // negative pid → the whole process group
        }, opts.killGraceMs ?? 250).unref?.();
      }
      settle({
        code: TIMED_OUT_CODE,
        output: output + (output.endsWith("\n") ? "" : "\n") + TIMED_OUT_MARKER,
      });
    }, opts.timeoutMs);
  });
}

/**
 * Default `AcExec`: a {@link runBounded} call with the generous default bound and the ambient
 * environment as its base (the real cluster/local run needs a working PATH). The bound, the
 * non-interactive stdin, `GIT_TERMINAL_PROMPT=0`, and the repo-local `node_modules/.bin` prefix
 * all come from `runBounded` — this wrapper just supplies the policy defaults.
 */
const defaultAcExec: AcExec = (run, cwd) =>
  runBounded(run, cwd, {
    timeoutMs: DEFAULT_AC_TIMEOUT_MS,
    env: process.env,
  });

/** Format one verification's evidence: the command, its exit code, and a clipped output tail. */
function acEvidence(run: string, code: number | null, output: string): string {
  const lines = output.split("\n").map((l) => l.replace(/\s+$/, ""));
  const tail = lines
    .filter((l, i, a) => l.length > 0 || i < a.length - 1)
    .slice(-8)
    .join("\n")
    .trim();
  const head = `$ ${run} → exit ${code ?? "null"}`;
  // On a FAILURE, the summary counts alone are useless for the rework round (the
  // "# fail 1" tail says nothing about WHAT failed) — so carry the first failing
  // assertion block too: from the first `not ok` line through its YAML diagnostic
  // (name, error, failureType), capped. This is what the re-authoring worker and
  // the human read; without it every red is "see the logs" archaeology.
  let failDetail = "";
  if (code !== 0) {
    const at = lines.findIndex((l) => /^\s*not ok /.test(l));
    if (at !== -1)
      failDetail = lines
        .slice(at, at + 14)
        .join("\n")
        .trim();
  }
  const body = [
    failDetail ? clip(failDetail, 900) : "",
    tail ? clip(tail, 600) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return body ? `${head}\n${body}` : head;
}

/**
 * Run the Spec's declared per-AC verifications as a complete plan (SP-tgzyfy): each check runs
 * in `cwd` (the worktree / live cluster), in declared order, and its pass/fail is attributed
 * back to the AC it proves. A command that exits 0 → pass; non-zero → fail; one that can't run
 * at all (spawn error) → fail with an "could not run" evidence (the no-skip: un-runnable ⇒ red,
 * never silently green). Returns one `AcResult` per declared verification.
 */
export async function runAcVerifications(
  verifs: AcVerification[],
  cwd: string,
  exec: AcExec = defaultAcExec,
  assess?: AssessContext,
): Promise<AcResult[]> {
  const out: AcResult[] = [];
  // AC7 (SP-6/7): run each DISTINCT runnable command at most once; a later AC declaring the same
  // command reuses the cached exit/output (or the cached spawn error) rather than re-running it.
  // Assessment ACs are never cached — each is graded against its own AC intent by the assessor.
  const runCache = new Map<
    string,
    { code: number | null; output: string } | { error: string }
  >();
  for (const v of verifs) {
    // `env: "assessment"` (SP-6/7 AC3): grade by dispatching a fresh independent assessor — never a
    // runnable command. No assessor injected ⇒ un-runnable ⇒ red (the no-skip rule: never silently green).
    if (v.env === "assessment") {
      if (!assess?.assessAc) {
        out.push({
          ac: v.ac,
          pass: false,
          evidence: `assessment AC #${v.ac} → could not run: no independent assessor available`,
        });
        continue;
      }
      try {
        const intent = assess.intentFor?.(v.ac) ?? "";
        const { pass, rationale } = await assess.assessAc(
          v,
          intent,
          assess.artifact ?? "",
        );
        out.push({
          ac: v.ac,
          pass,
          evidence: `assessment (independent) → ${pass ? "pass" : "fail"}: ${clip(
            (rationale ?? "").trim() || "(no rationale)",
            600,
          )}`,
        });
      } catch (err) {
        out.push({
          ac: v.ac,
          pass: false,
          evidence: `assessment AC #${v.ac} → could not run: ${(err as Error).message}`,
        });
      }
      continue;
    }
    // AC7 de-dup: exec a given command once, then map its result to every AC that declared it.
    let cached = runCache.get(v.run);
    if (!cached) {
      try {
        cached = await exec(v.run, cwd);
      } catch (err) {
        cached = { error: (err as Error).message };
      }
      runCache.set(v.run, cached);
    }
    if ("error" in cached) {
      out.push({
        ac: v.ac,
        pass: false,
        evidence: `$ ${v.run} → could not run: ${cached.error}`,
      });
    } else {
      out.push({
        ac: v.ac,
        pass: cached.code === 0,
        evidence: acEvidence(v.run, cached.code, cached.output),
      });
    }
  }
  return out;
}

/**
 * Tick the given 1-based AC ordinals (`- [ ]` → `- [x]`) under the Spec body's
 * `## Acceptance Criteria` heading, leaving everything else byte-for-byte. Out-of-range or
 * already-checked ordinals are no-ops. Pure — the shell writes the result back to the Spec doc
 * so the accept gate (every AC checked) can pass. Mirrors `extractAcceptanceCriteria`'s parser.
 */
export function checkAcOrdinals(body: string, ordinals: number[]): string {
  const want = new Set(ordinals.filter((n) => Number.isInteger(n) && n > 0));
  if (!want.size) return body;
  const lines = (body ?? "").split(/\r?\n/);
  let inSection = false;
  let ordinal = 0;
  for (let i = 0; i < lines.length; i++) {
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (heading) {
      const text = heading[2].trim().toLowerCase();
      inSection =
        text === "acceptance criteria" || text === "acceptance_criteria";
      continue;
    }
    if (!inSection) continue;
    const cb = /^(\s*[-*+]\s*)\[([ xX])\](\s+.+)$/.exec(lines[i]);
    if (!cb) continue;
    ordinal++;
    if (want.has(ordinal) && cb[2] === " ") {
      lines[i] = `${cb[1]}[x]${cb[3]}`;
    }
  }
  return lines.join("\n");
}

// ── Finalization watchdog (SP-th4wqc_SL-2 / TEP-th3i18 #11) ────────────────
//
// A run can land every execution unit and then silently wedge — the finalize tail
// (commit the Spec, write DELIVERY.md, advance the slice off `ready`) never fires, so
// the work sits done-but-uncommitted and the loop stalls without surfacing anything.
// `finalizationVerdict` is the pure detector wired into `dispatchSpec`: consulted once
// the run believes it's quiescent, it reports `{ wedged }` when the units are done but
// the finalize markers are absent, so the shell can surface Requires-attention with a
// diagnosis instead of looping forever. The diagnosis text is exported as a constant so
// the test asserts against it (never a hand-copied string that can drift).

/**
 * The single, machine-checkable phrase a finalization wedge is diagnosed with. The watchdog
 * surfaces it (verbatim, possibly with appended specifics) and the test asserts via THIS constant
 * — never a hardcoded copy — so the message and its assertion can never silently diverge.
 */
export const FINALIZATION_WEDGED_DIAGNOSIS =
  "units done but run never finalized";

/**
 * What `finalizationVerdict` inspects: whether the run reached quiescence (every dispatched
 * execution unit landed) and whether each finalize marker is present. A finalized run has a
 * commit SHA, a written DELIVERY.md, and no slice still sitting on `ready`.
 */
export interface FinalizationState {
  /** Did every dispatched execution unit land (the run believes it's complete)? */
  unitsAllDone: boolean;
  /** The HEAD sha the Spec was committed at — falsy (empty/undefined) ⇒ nothing committed. */
  committedSha?: string;
  /** Was the auditable DELIVERY.md report written this run? */
  deliveryWritten: boolean;
  /** Slices still in `ready` after the run — non-empty ⇒ a slice was never advanced off `ready`. */
  slicesStillReady?: string[];
}

/**
 * Pure finalization watchdog (SP-th4wqc_SL-2): given the run's quiescence + finalize-marker
 * state, return `'finalized'` when the run is healthy (or not yet at the finalize check), or
 * `{ wedged }` when the units are **done** but one or more finalize markers — commit SHA,
 * DELIVERY.md, slice moved off `ready` — are **absent**. The `wedged` string always contains
 * `FINALIZATION_WEDGED_DIAGNOSIS` (assert with that constant, e.g. `.includes` / `toContain`),
 * with the missing markers appended for the operator. When the units are not all done there is
 * nothing to finalize yet, so the verdict is `'finalized'` (no wedge) — the caller is expected to
 * consult this only at run quiescence.
 */
export function finalizationVerdict(
  state: FinalizationState,
): "finalized" | { wedged: string } {
  if (!state.unitsAllDone) return "finalized";
  const missing: string[] = [];
  if (!state.committedSha) missing.push("commit SHA");
  if (!state.deliveryWritten) missing.push("DELIVERY.md");
  if ((state.slicesStillReady ?? []).length) missing.push("slice off `ready`");
  if (!missing.length) return "finalized";
  return {
    wedged: `${FINALIZATION_WEDGED_DIAGNOSIS} (missing: ${missing.join(", ")})`,
  };
}

// ── Atomic, resumable per-slice commit (SP-th4wqc_SL-3 / TEP-th3i18 #9) ────
//
// Today commit is all-or-nothing at run quiescence, so a partial gate or a git
// failure can leave a slice on `Done` with uncommitted work — a sticky-Done lie. SL-3
// reworks the finalize tail to **commit-before-Done, per slice**, and makes a re-run
// **resume** rather than re-author. Two pure functions are the single contract the
// `OrchestratorService` shell + the AC4 test read:
//
//   • `commitPlan(sliceOutcomes)` — the per-slice DECISION: which slices are eligible to
//     commit-then-Done (units landed ∧ gate-green) and which must roll back to `ready`.
//   • `resumeDecision(sliceState)` — what a (re-)run does with a slice it encounters:
//     `'author'` (run the units), `'commit'` (work is already present uncommitted — commit
//     it WITHOUT re-authoring), or `'skip'` (already committed/Done/archived — leave it).
//
// Both are I/O-free: the shell supplies the observed state, acts on the verdict (real git),
// and — because commit itself is I/O that can fail — applies the **commit-failure protocol**
// documented on `commitPlan`: attempt each `commit` handle's git commit; a handle whose commit
// fails is treated as a rollback (→ `ready`, NOT Done), so only commit-succeeded slices end Done.

/** One slice's outcome feeding the per-slice commit decision (SP-th4wqc_SL-3 / #9). */
export interface SliceOutcome {
  /** Slice handle, e.g. "SP-3_SL-2". */
  handle: string;
  /** Did every execution unit of this slice land (its worker(s) finished, no needs-input / failure)? */
  unitsLanded: boolean;
  /** Did this slice's closing-gate verifications all pass? A slice with no gate of its own inherits
   *  the run-level verdict — the shell passes the effective (per-slice) result here. */
  gatePassed: boolean;
}

/**
 * The per-slice commit decision (SP-th4wqc_SL-3). `commit` lists the handles whose work is complete
 * AND gate-green — the shell commits each (commit-before-Done) then marks it Done. `rollback` lists
 * the handles that must NOT end Done — moved back to `ready` so a later run re-attempts them.
 */
export interface CommitPlan {
  /** Handles eligible to commit-then-Done (units landed ∧ gate passed). */
  commit: string[];
  /** Handles rolled back to `ready` (units didn't all land, or the gate failed). */
  rollback: string[];
}

/**
 * Pure per-slice commit planner (SP-th4wqc_SL-3 / TEP-th3i18 #9): partition the run's slice
 * outcomes into the slices to **commit** (every unit landed ∧ the slice's gate passed) and the
 * slices to **roll back** to `ready` (anything else — partial landing or a failed gate). This is
 * the no-sticky-Done invariant: a slice is only ever committed-then-Done when its work is complete
 * and green, so a partial-gate failure rolls the rest to `ready` rather than freezing them Done.
 *
 * Commit is I/O that can still fail at the git layer (e.g. AC4's fake git that fails one slice's
 * commit). The shell honours this **commit-failure protocol**: attempt each `commit` handle's git
 * commit in order; if a commit fails, treat that handle as a rollback (→ `ready`, NOT Done). Only
 * handles whose commit actually succeeded end Done — so no slice is ever Done with uncommitted work.
 */
export function commitPlan(sliceOutcomes: SliceOutcome[]): CommitPlan {
  const commit: string[] = [];
  const rollback: string[] = [];
  for (const o of sliceOutcomes ?? []) {
    if (o && o.unitsLanded && o.gatePassed) commit.push(o.handle);
    else if (o) rollback.push(o.handle);
  }
  return { commit, rollback };
}

/** What a slice looks like at the start of a (re-)run, for the resume decision (SP-th4wqc_SL-3 / #9). */
export interface SliceState {
  /** Frontmatter status: ready | doing | done | requires-attention | archived. */
  status: string;
  /** Did every execution unit of this slice already land — its work present in the worktree? */
  unitsLanded: boolean;
  /** Has this slice's work already been committed (a commit SHA recorded for it)? */
  committed: boolean;
}

/**
 * Pure resume planner (SP-th4wqc_SL-3 / TEP-th3i18 #9): decide what a (re-)run does with a slice it
 * encounters, so a resume **commits** rather than **re-authors** already-present work — the AC4
 * invariant the spy `runUnit` asserts (not called for a complete-but-uncommitted slice on re-run).
 *
 *   • `'skip'`   — archived, or already committed (Done): nothing to do.
 *   • `'commit'` — units already landed but NOT yet committed (complete-but-uncommitted): commit it
 *                  WITHOUT re-authoring — the frontier never re-dispatches a worker for it.
 *   • `'author'` — work not yet present: (re-)author the units as normal.
 */
export function resumeDecision(
  sliceState: SliceState,
): "author" | "commit" | "skip" {
  const status = (sliceState?.status ?? "").toLowerCase();
  if (status === "archived") return "skip";
  if (sliceState?.committed) return "skip";
  if (sliceState?.unitsLanded) return "commit";
  return "author";
}

// ── Durable, structured verification trace (SP-6/7 AC5) ────────────────────
//
// The delivery report's per-AC table is ephemeral prose; AC5 needs a DURABLE, structured record —
// per AC and per rework round — of HOW each criterion was verified, so the methodology itself can be
// debugged and improved. `buildVerificationTrace` derives that structure from the per-AC results: for
// each AC it records the verification `kind` (a held-out `probe` command vs an independent
// `assessment`), the `verdict`, the assessor/judge `rationale`, and — when the run was red and judged
// — the code-vs-test `route`. The shell persists it as JSON alongside DELIVERY.md (accumulating across
// runs, keyed by AC + round) and surfaces it in the delivery report + panel.

/** One entry of the structured verification trace (SP-6/7 AC5) — one AC's verdict in one rework round. */
export interface VerificationTraceEntry {
  /** 1-based AC ordinal this entry records. */
  ac: number;
  /** The rework round it was verified in (1 = the first attempt; bumped each re-dispatch). */
  round: number;
  /** How it was verified: a held-out `probe` command, or an independent `assessment`. */
  kind: "probe" | "assessment";
  verdict: "pass" | "fail";
  /** The assessor's rationale / the probe's evidence tail — why this verdict. */
  rationale?: string;
  /** SP-6/7 AC4: the judged code-vs-test route recorded for a FAILED AC (absent on a pass / un-judged). */
  route?: Fault;
}

/** Inputs to {@link buildVerificationTrace}: one run's per-AC results + how to place each in the trace. */
export interface VerificationTraceInput {
  /** The rework round this run represents for the AC's slice (1-based). A number, or a per-AC lookup. */
  round: number | ((ac: number) => number);
  /** The declared per-AC plan — its `env` distinguishes `assessment` from a runnable `probe`. */
  declared: AcVerification[];
  /** The per-AC results (pass/fail + evidence) this run produced. */
  acResults: AcResult[];
  /** AC ordinal → the judged re-dispatch route for a FAILED AC (SP-6/7 AC4). */
  routes?: ReadonlyMap<number, Fault> | Record<number, Fault>;
}

/**
 * Build one run's slice of the structured verification trace (SP-6/7 AC5): one entry per AC result,
 * recording its round, verification kind (`assessment` when the declared `env` is `assessment`, else a
 * held-out `probe`), verdict, rationale (the evidence tail — the assessor's rationale for an
 * assessment, the command output for a probe), and — for a failed, judged AC — the code-vs-test route.
 * Pure → unit-tested; the shell merges these into the durable per-Spec trace file. See AC5.
 */
export function buildVerificationTrace(
  i: VerificationTraceInput,
): VerificationTraceEntry[] {
  const envByAc = new Map(i.declared.map((v) => [v.ac, v.env]));
  const roundOf = (ac: number): number =>
    typeof i.round === "function" ? i.round(ac) : i.round;
  const routeOf = (ac: number): Fault | undefined => {
    const r = i.routes;
    if (!r) return undefined;
    return r instanceof Map ? r.get(ac) : (r as Record<number, Fault>)[ac];
  };
  return i.acResults.map((r) => {
    const kind: VerificationTraceEntry["kind"] =
      envByAc.get(r.ac) === "assessment" ? "assessment" : "probe";
    const entry: VerificationTraceEntry = {
      ac: r.ac,
      round: roundOf(r.ac),
      kind,
      verdict: r.pass ? "pass" : "fail",
      rationale: (r.evidence ?? "").trim() || undefined,
    };
    const route = routeOf(r.ac);
    if (!r.pass && route) entry.route = route;
    return entry;
  });
}

/**
 * Merge this run's trace entries into the durable, accumulating per-Spec trace (SP-6/7 AC5). Keyed on
 * `ac`+`round`, a new entry REPLACES an existing one for the same AC+round (a re-run of the same round
 * overwrites its stale verdict) and is otherwise appended — so the persisted trace carries every AC
 * across every rework round without duplication. Sorted by round then AC for a stable, readable file.
 * Pure → the shell reads the prior file, calls this, and writes the result back.
 */
export function mergeVerificationTrace(
  prior: VerificationTraceEntry[],
  next: VerificationTraceEntry[],
): VerificationTraceEntry[] {
  const key = (e: VerificationTraceEntry) => `${e.round}::${e.ac}`;
  const byKey = new Map<string, VerificationTraceEntry>();
  for (const e of prior ?? []) byKey.set(key(e), e);
  for (const e of next ?? []) byKey.set(key(e), e);
  return [...byKey.values()].sort((a, b) => a.round - b.round || a.ac - b.ac);
}

/** One execution unit's outcome, for the delivery report's per-unit table. */
export interface ReportUnit {
  id: string;
  outcome: "success" | "needs-input" | "failed";
}

/**
 * SP-11/2 — the id of a post-orchestration exit. The exit SET is derived from the run's terminal
 * state (see {@link deliveryExitState}), never glued on fixed: a **delivered** run offers
 * `accept` / `request-changes`; a **stalled** run offers `attend` / `rerun` — no impossible
 * `accept` on a stalled run, no mislabeled reject.
 */
export type ExitActionId = "accept" | "request-changes" | "attend" | "rerun";

/** SP-11/2 — one post-orchestration exit: a stable `id` (dispatched on) + its human `label`. */
export interface ExitAction {
  id: ExitActionId;
  label: string;
}

/**
 * SP-11/2 — the SINGLE source of truth mapping a run's terminal state to its exit set. Both the
 * delivery report's `## Next` section and the graph's buttons consume THIS (no second derivation):
 *
 *   • **delivered** ⇔ the change committed AND the closing gate passed → exits
 *     `[accept ("Accept & merge"), request-changes ("Request changes")]`, in that order;
 *   • **stalled** ⇔ anything else (not committed and/or the gate did not pass) → exits
 *     `[attend ("Attend"), rerun ("Re-run")]`, in that order — the actions that actually apply to a
 *     run that did not deliver (no impossible Accept, no mislabeled Reject).
 *
 * Labels are pinned exactly. Pure → unit-tested.
 */
export function deliveryExitState(run: {
  committed: boolean;
  gatePassed: boolean;
}): { state: "delivered" | "stalled"; exits: ExitAction[] } {
  return run.committed && run.gatePassed
    ? {
        state: "delivered",
        exits: [
          { id: "accept", label: "Accept & merge" },
          { id: "request-changes", label: "Request changes" },
        ],
      }
    : {
        state: "stalled",
        exits: [
          { id: "attend", label: "Attend" },
          { id: "rerun", label: "Re-run" },
        ],
      };
}

/**
 * SP-11/2 — the one-line hint rendered after each exit's bold label in the delivery report's
 * `## Next` section (`N. **<label>** — <hint>`). Keyed by {@link ExitActionId} so the report and
 * the exit-state model can never drift on what each action means.
 */
const NEXT_HINTS: Record<ExitActionId, string> = {
  accept:
    "merge the Spec to `main` (gated on every AC checked) — the per-AC table above is the evidence.",
  "request-changes":
    "open a primed `/attend` session to steer the delivered change back in line with the intent.",
  attend:
    "open a primed session on the requires-attention slice(s) to bring the behaviour back in line.",
  rerun:
    "resolve the requires-attention slice(s), then re-run the orchestrator.",
};

/** Everything the auditable delivery report (DELIVERY.md) records (SP-tgzyfy). */
export interface DeliveryReportInput {
  specNumber: string;
  /** Short HEAD sha the Spec was committed at (or "" when nothing committed). */
  sha: string;
  /** The union of the units' footprints. */
  files: string[];
  /** Per-execution-unit outcomes. */
  units: ReportUnit[];
  /** The declared per-AC verification plan (how each AC is verified). */
  declared: AcVerification[];
  /** The per-AC verification results (pass/fail + evidence). Empty when the gate couldn't run. */
  acResults: AcResult[];
  /** Worker-reported problems / requires-attention diagnoses caught this run. */
  problems?: string[];
  /** Slices advanced to Done this run. */
  advanced: string[];
  /** Slices left requires-attention this run. */
  attention?: string[];
  /** The whole Spec landed green and was committed. */
  committed: boolean;
  /** The durable, structured verification trace (SP-6/7 AC5) — per AC and per rework round: kind,
   *  verdict, rationale, and any code-vs-test route. Rendered as an auditable table; omitted/empty ⇒
   *  the trace section is left off (backward-compatible with pre-AC5 reports). */
  trace?: VerificationTraceEntry[];
  /** SP-11/3: the closing-gate judge's UNCLIPPED per-AC rationale. On a failed run these texts are
   *  rendered VERBATIM (never truncated) as the flowing `## What happened` prose — the diagnosis stops
   *  dying after the trace-table clip. Omitted ⇒ a plain failure/success summary is synthesized. */
  diagnosis?: { ac: number; text: string }[];
  /** SP-11/3: the Spec's criterion lines, index k-1 ↔ AC k. When supplied, the `## Acceptance criteria`
   *  rows carry the criterion's TEXT (`#k — <acTexts[k-1]> — <verdict>`) instead of a bare ordinal
   *  table; omitted ⇒ today's ordinal-only table form remains. */
  acTexts?: string[];
  /** SP-11/3: out-of-scope findings workers reported under a trailing `## Discoveries` heading, each
   *  paired with its unit id by the orchestrator. Rendered under `## Discoveries & recommendations`
   *  (both unit and text); empty/omitted ⇒ the literal "none reported". */
  discoveries?: { unit: string; text: string }[];
  /** Repair window (2026-07-08): the `prepare` build failure that stopped the closing gate before
   *  ANY AC could run — command + bounded raw output. Rendered as a first-class
   *  `## Build failed before verification` section right after `## What happened`, so the one
   *  failure that blocks every criterion never renders as a blank "all ACs not run / no evidence". */
  buildFailure?: { command: string; output: string };
  /** SP-11/2 — the run's state-derived exit set ({@link deliveryExitState}). When present,
   *  `buildDeliveryReport` renders the `## Next` section as numbered bold-label lines
   *  (`N. **<label>** — <hint>`) from it; omitted ⇒ the hard-coded Next text remains
   *  (backward-compatible). */
  exits?: ExitAction[];
}

/**
 * Build the auditable delivery report (DELIVERY.md) — the operator's document (SP-11/3). The
 * closing gate writes it on EVERY completion (pass or fail), in a human-first section order:
 *
 *   `# Delivery —` → `## What happened` → `## Acceptance criteria` →
 *   `## Discoveries & recommendations` → `## Files` → `## Next` → `## Evidence appendix`
 *
 * **What happened** opens in plain language: on a FAILURE (nothing committed OR any AC red) it is the
 * closing-gate judge's diagnosis (`i.diagnosis`) rendered VERBATIM and unclipped as flowing prose; on
 * SUCCESS it is a plain summary of what was delivered. **Acceptance criteria** carries the criterion's
 * TEXT (`#k — <acTexts[k-1]> — <verdict>`) when `i.acTexts` is supplied, else today's ordinal-only
 * table. **Discoveries & recommendations** surfaces workers' out-of-scope findings ("none reported"
 * when empty). The raw runner output (per-AC fenced evidence blocks) and the machine-readable
 * verification trace table are DEMOTED — not deleted — into the trailing **Evidence appendix**, along
 * with the per-unit outcomes and any caught problems. Pure → unit-tested.
 */
export function buildDeliveryReport(i: DeliveryReportInput): string {
  const tep = `TEP-${i.specNumber.replace("/", "_SP-")}`;
  const branch = `spec/${tep}`;
  const failed = !i.committed || i.acResults.some((r) => !r.pass);

  // ── ## What happened — plain-language, diagnosis VERBATIM on failure ──────────
  // On failure the judge's per-AC diagnosis texts are joined as prose, each one UNCLIPPED (the
  // diagnosis stops dying after the trace-table clip). On success a plain delivery summary.
  const diagTexts = (i.diagnosis ?? [])
    .map((d) => d?.text)
    .filter((t): t is string => !!t && !!t.trim());
  const whatHappened = failed
    ? i.buildFailure
      ? "The assembled change did not build, so verification never started — every acceptance criterion below reads *not run* because of the single build failure shown next, not because of individual criterion failures."
      : diagTexts.length
        ? diagTexts.join("\n\n")
        : "The closing gate did not pass. The acceptance criteria below record which criteria are red; the evidence appendix carries the raw runner output for why."
    : `Delivered ${i.advanced.length} slice(s) to Done across ${i.units.length} execution unit(s), committed to \`${branch}\`${i.sha ? ` at \`${i.sha}\`` : ""}.`;

  // ── ## Build failed before verification (repair window, 2026-07-08) ───────────
  // The one failure that blocks EVERY criterion gets first-class, raw-output billing.
  const buildFailSection = i.buildFailure
    ? [
        "## Build failed before verification",
        "",
        `\`$ ${i.buildFailure.command}\``,
        "",
        "```",
        i.buildFailure.output.trim() || "(no output captured)",
        "```",
        "",
      ]
    : [];

  // ── ## Acceptance criteria — criterion text + verdict, or the ordinal table ───
  const resultFor = new Map(i.acResults.map((r) => [r.ac, r]));
  const verdictOf = (ac: number): string => {
    const r = resultFor.get(ac);
    return !r ? "· not run" : r.pass ? "✓ pass" : "✗ fail";
  };
  const hasAcTexts = !!(i.acTexts && i.acTexts.length);
  let acSection: string[];
  if (!i.declared.length) {
    acSection = [
      "## Acceptance criteria",
      "",
      "**No `ac_verifications` declared on the Spec — the closing gate could not run.** " +
        "The acceptance criteria were NOT verified; the Spec is left `requires-attention` " +
        "(no skip, TEP-tgzx3p). Declare a per-AC verification map on the Spec, then re-run.",
    ];
  } else if (hasAcTexts) {
    // Criterion-text rows: keep today's `#k` ordinal token, carry the Spec's criterion line.
    acSection = [
      "## Acceptance criteria",
      "",
      ...i.declared.map((v) => {
        const text =
          (i.acTexts?.[v.ac - 1] ?? "").trim() ||
          "(criterion text unavailable)";
        return `- #${v.ac} — ${text} — ${verdictOf(v.ac)}`;
      }),
    ];
  } else {
    // Ordinal-only table form (acTexts omitted) — unchanged.
    acSection = [
      "## Acceptance criteria",
      "",
      "| AC | Verified by | Env | Result |",
      "| --- | --- | --- | --- |",
      ...i.declared.map(
        (v) =>
          `| #${v.ac} | \`${v.run.replace(/\|/g, "\\|")}\` | ${v.env ?? "—"} | ${verdictOf(v.ac)} |`,
      ),
    ];
  }

  // ── ## Discoveries & recommendations — both unit and text, "none reported" empty ─
  const discoveries = (i.discoveries ?? []).filter(
    (d) => d && ((d.text ?? "").trim() || (d.unit ?? "").trim()),
  );
  const discSection = [
    "## Discoveries & recommendations",
    "",
    ...(discoveries.length
      ? discoveries.map((d) => `- \`${d.unit}\` — ${d.text}`)
      : ["none reported"]),
  ];

  // ── ## Files ──────────────────────────────────────────────────────────────────
  const fileList = i.files.length
    ? i.files.map((f) => `- \`${f}\``).join("\n")
    : "- (none)";

  // ── ## Evidence appendix — raw runner output + trace + unit outcomes, demoted ──
  const acEvidenceBlocks = i.acResults.length
    ? i.acResults
        .map(
          (r) =>
            `**AC #${r.ac}** — ${r.pass ? "✓ pass" : "✗ fail"}\n\n\`\`\`\n${r.evidence}\n\`\`\``,
        )
        .join("\n\n")
    : "_No per-AC evidence captured this run._";

  // SP-6/7 AC5: the durable, structured verification trace — demoted into the evidence appendix.
  const trace = i.trace ?? [];
  const traceBlock = trace.length
    ? [
        "### Verification trace",
        "",
        "| AC | Round | Kind | Verdict | Route | Rationale |",
        "| --- | --- | --- | --- | --- | --- |",
        ...trace.map((e) => {
          const v = e.verdict === "pass" ? "✓ pass" : "✗ fail";
          const rationale = clip(
            (e.rationale ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|"),
            160,
          );
          return `| #${e.ac} | ${e.round} | ${e.kind} | ${v} | ${e.route ?? "—"} | ${rationale || "—"} |`;
        }),
        "",
      ]
    : [];

  const glyph = (o: ReportUnit["outcome"]) =>
    o === "success" ? "✓" : o === "needs-input" ? "❓" : "✗";
  const unitRows = i.units.length
    ? i.units.map((u) => `| \`${u.id}\` | ${glyph(u.outcome)} ${u.outcome} |`)
    : ["| — | (none) |"];
  const unitBlock = [
    "### Execution units",
    "",
    "| Unit | Outcome |",
    "| --- | --- |",
    ...unitRows,
    "",
  ];

  const problems = (i.problems ?? []).filter(Boolean);
  const problemBlock = problems.length
    ? ["### Caught problems", "", ...problems.map((p) => `- ${p}`), ""]
    : [];

  // SP-11/2 — the `## Next` items. With a state-derived exit set present, render numbered
  // bold-label lines (`N. **<label>** — <hint>`) from it — one source of truth for the report
  // and the graph's buttons. Omitted ⇒ the hard-coded text (backward-compatible).
  const nextLines =
    i.exits && i.exits.length
      ? i.exits.map(
          (e, idx) => `${idx + 1}. **${e.label}** — ${NEXT_HINTS[e.id] ?? ""}`,
        )
      : [
          i.committed
            ? `1. Review the \`${branch}\` branch (the committed change) — the acceptance criteria above and the evidence appendix are the proof.\n` +
              `2. **Accept** to merge the Spec to \`main\` (gated on every AC checked), or **Reject** to open a primed session.`
            : `1. The closing gate did not pass — see What happened above and the evidence appendix below.\n` +
              `2. Resolve the requires-attention slice(s), then re-run the orchestrator.`,
        ];

  const appendix = [
    "## Evidence appendix",
    "",
    acEvidenceBlocks,
    "",
    ...traceBlock,
    ...unitBlock,
    ...problemBlock,
  ];

  return [
    `# Delivery — ${tep}`,
    "",
    `Orchestrated to branch \`${branch}\`${i.sha ? ` at \`${i.sha}\`` : ""}. ` +
      `${i.advanced.length} slice(s) advanced to Done; ${i.units.length} execution unit(s) ran` +
      `${i.committed ? " — committed ✓" : " — not committed"}.`,
    "",
    "## What happened",
    "",
    whatHappened,
    "",
    ...buildFailSection,
    ...acSection,
    "",
    ...discSection,
    "",
    "## Files",
    "",
    fileList,
    "",
    "## Next",
    "",
    ...nextLines,
    "",
    ...appendix,
    "",
  ].join("\n");
}
