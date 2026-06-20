/**
 * Pure, vscode-free core of the board orchestrator (SP-tgs8nz_SL-1): picking the next
 * dispatchable slice and parsing a `claude -p --output-format stream-json` event stream.
 * No I/O — the `OrchestratorService` shell supplies board rows + raw stdout and acts on
 * the results. Unit-tested directly (high AI-testability per the lever, SP-tgsdvw); the
 * live spawn / verify / advance is the shell's job — a human verdict (low AI-testability).
 */

export interface SliceRow {
  /** Slice handle, e.g. "SP-3_SL-2". */
  handle: string;
  /** Frontmatter status: ready | doing | done | archived. */
  status: string;
  /** `depends_on` handles. */
  dependsOn: string[];
}

/**
 * Pick the next dispatchable slice: the first **ready** slice (in input order) whose every
 * `dependsOn` handle is **done**. Returns its handle, or null if none is dispatchable. A
 * dep missing from `rows` counts as not-done (blocks) — fail safe. One-in-flight / the
 * concurrency cap is the shell's concern, not this picker's.
 */
export function pickNextSlice(rows: SliceRow[]): string | null {
  return pickFrontier(rows)[0] ?? null;
}

/**
 * The **ready frontier**: every dispatchable slice (status **ready** with every `dependsOn`
 * **done**), in input order. SL-2's bounded fan-out runs a footprint-disjoint subset of this
 * up to the per-Spec concurrency cap; SL-1's `pickNextSlice` is just its width-1 head.
 */
export function pickFrontier(rows: SliceRow[]): string[] {
  const statusOf = new Map(
    rows.map((r) => [r.handle, (r.status ?? "").toLowerCase()]),
  );
  return rows
    .filter((r) => (r.status ?? "").toLowerCase() === "ready")
    .filter((r) => !(r.dependsOn ?? []).some((d) => statusOf.get(d) !== "done"))
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
 * drains as slots free (AC3 — the per-Spec `claude -p` cap). Results are returned in input
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
  depends_on?: string[];
  execution: "serial" | "mechanize" | "fan-out";
}

export interface ExecutionUnit {
  shape: "serial" | "mechanize" | "fan-out";
  units: WorkUnit[];
}

/**
 * Batch one slice's work units into **execution units** to amortize `claude -p` cold-start
 * (AC6): all `serial` units collapse into ONE execution unit (a single warm session, run in
 * order); each `mechanize` (codemod-once) and each `fan-out` (parallel-eligible) unit is its
 * own execution unit. Never spans slices — the caller passes a single slice's units, so
 * cross-slice economy can only come from warm-session reuse, never from merging slices.
 */
export function batchExecutionUnits(units: WorkUnit[]): ExecutionUnit[] {
  const out: ExecutionUnit[] = [];
  const serial = units.filter((u) => u.execution === "serial");
  if (serial.length) out.push({ shape: "serial", units: serial });
  for (const u of units.filter((u) => u.execution === "mechanize"))
    out.push({ shape: "mechanize", units: [u] });
  for (const u of units.filter((u) => u.execution === "fan-out"))
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
  /** Slice-level `depends_on` (handles). */
  dependsOn: string[];
  /** Declared `files:` (the footprint for a unit-less legacy slice). */
  files: string[];
  /** `work_units` (may be empty → the whole slice is one serial unit). */
  workUnits: (WorkUnit & { note?: string })[];
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
  dependsOn: string[];
  shape: "serial" | "mechanize" | "fan-out";
  /** The unit's task text(s), for the worker prompt. */
  note?: string;
  /** The underlying work units (for the worker prompt + footprint). */
  units?: WorkUnit[];
}

/**
 * Expand a Spec's slices into the **execution-unit DAG** the scheduler runs over: each
 * slice's work units are batched by shape (`batchExecutionUnits`), and every resulting
 * execution unit becomes a node — pooled across all slices into one graph. A slice with
 * no `work_units` (legacy) becomes ONE serial node whose footprint is its declared
 * `files`. Each node inherits its slice's `depends_on` (the slice can't start until its
 * dep-slices are done) plus its work units' own `depends_on`.
 */
export function buildUnitDag(slices: SliceForDag[]): SchedUnit[] {
  const out: SchedUnit[] = [];
  for (const s of slices) {
    const sliceDeps = s.dependsOn ?? [];
    const units = s.workUnits ?? [];
    if (units.length === 0) {
      out.push({
        id: s.handle,
        slice: s.handle,
        footprint: s.files ?? [],
        dependsOn: [...sliceDeps],
        shape: "serial",
      });
      continue;
    }
    batchExecutionUnits(units).forEach((eu, i) => {
      const footprint = [
        ...new Set(eu.units.flatMap((u) => u.footprint ?? [])),
      ];
      const dependsOn = [
        ...new Set([...sliceDeps, ...eu.units.flatMap((u) => u.depends_on ?? [])]),
      ];
      const note =
        eu.units
          .map((u) => (u as WorkUnit & { note?: string }).note)
          .filter(Boolean)
          .join("; ") || undefined;
      out.push({
        id: `${s.handle}#eu-${i}`,
        slice: s.handle,
        footprint,
        dependsOn,
        shape: eu.shape,
        note,
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
}

/**
 * The scheduler's **ready frontier**: execution units that are not done, not blocked, whose
 * every dependency is satisfied (`done`), and whose footprint doesn't overlap a running unit
 * — ordered **critical-path first** (longest remaining chain of dependents) and narrowed to a
 * footprint-**disjoint** set so a batch dispatched together can't collide. A slice-handle dep
 * is satisfied once the shell marks that slice done (all its units landed).
 */
export function readyFrontier(
  units: SchedUnit[],
  state: SchedulerState,
): SchedUnit[] {
  const { done, running, blocked } = state;
  const candidates = units.filter(
    (u) =>
      !done.has(u.id) &&
      !blocked.has(u.id) &&
      !u.footprint.some((f) => running.has(f)) &&
      (u.dependsOn ?? []).every((d) => done.has(d)),
  );

  // critical-path order: longest remaining chain of dependents first.
  const dependents = new Map<string, string[]>();
  for (const u of units)
    for (const d of u.dependsOn ?? []) {
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

/**
 * Build the **autonomy-first prompt** for a worker dispatched on one execution unit
 * (SP-tgs8nz). Scoped to the unit's footprint + shape, it tells the worker to decide
 * autonomously (never seek confirmation), never touch git or the board, and escalate
 * with a question ONLY when genuinely blocked — the posture that keeps headless
 * execution from stopping on routine approvals. Pure → unit-tested.
 */
export function buildWorkerPrompt(unit: SchedUnit, specNumber: string): string {
  const m = /_SL-(\d+)$/.exec(unit.slice);
  const sliceFile = m ? `specs/SP-${specNumber}/SL-${m[1]}.md` : unit.slice;
  const fp = unit.footprint.join(", ") || "(no declared footprint)";
  const task =
    unit.shape === "mechanize"
      ? `This is a MECHANIZE unit: author ONE transform and apply it across all of [${fp}] — do not hand-edit each object.`
      : unit.shape === "fan-out"
        ? `This is a FAN-OUT unit over [${fp}].${unit.note ? ` Task: ${unit.note}` : ""}`
        : `This is a SERIAL unit — do its steps in order over [${fp}].${unit.note ? ` Task: ${unit.note}` : ""}`;
  return (
    `You are an autonomous Tandem worker for execution unit ${unit.id} of slice ${unit.slice}.\n` +
    `Read ${sliceFile} and its parent spec for context, then implement THIS unit only — touch only its footprint: ${fp}.\n\n` +
    `${task}\n\n` +
    `Work autonomously to the slice's acceptance criteria. Make reasonable engineering decisions and do NOT ask for confirmation. ` +
    `Do NOT commit, run git, or move the board card — the orchestrator owns git and the gate. ` +
    `Only if you hit a genuine decision you cannot make from the spec/slice/codebase, stop and state the question rather than guessing.`
  );
}

/**
 * Extract a requires-attention slice's failure diagnosis from its body — the text the
 * orchestrator appended under the `## ⚑ Requires attention` heading (SP-tgs8nz AC4). Returns
 * undefined if absent. `/attend` uses it to prime the resolution session.
 */
export function extractDiagnosis(body: string): string | undefined {
  const m = /##\s*⚑\s*Requires attention\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(
    body ?? "",
  );
  return m?.[1]?.trim() || undefined;
}

/** The chat prompt priming an `/attend` session: the slice, its diagnosis, and the exit. */
export function buildAttendPrompt(handle: string, diagnosis?: string): string {
  const diag = diagnosis
    ? `\n\nThe orchestrator's diagnosis:\n\n${diagnosis}`
    : "";
  return (
    `Attend the requires-attention slice ${handle} in this worktree.${diag}` +
    `\n\nResolve the problem, verify at slice grain, then move ${handle} back to Ready so the loop can pick it up.`
  );
}

/**
 * Line-buffered NDJSON parser for `claude -p --output-format stream-json`. Feed raw stdout
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
export function summarizeEvent(evt: Record<string, unknown>): string | null {
  if (evt.type === "system" && evt.subtype === "init")
    return "▸ session started";
  if (evt.type === "assistant") {
    const msg = evt.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const parts: string[] = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type === "text" && typeof b.text === "string")
        parts.push(b.text.trim());
      if (b.type === "tool_use" && typeof b.name === "string")
        parts.push(`▸ ${b.name}`);
    }
    const s = parts.filter(Boolean).join(" ");
    return s || null;
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
