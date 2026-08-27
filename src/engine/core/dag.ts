import { isEscalated } from "./redispatch";
import { ExecutionUnit, WorkUnit, batchExecutionUnits } from "./base";
// ── Work-unit DAG scheduler (makespan over the Spec's units) ─────────────
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
  /** 1-based AC ordinals the slice `satisfies` — the closing gate advances the slice
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

