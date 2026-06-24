/**
 * Pure, vscode-free core of the board orchestrator (SP-tgs8nz_SL-1): the work-unit DAG +
 * scheduler, plus session-log helpers that parse a worker's persisted `.jsonl` events.
 * Mostly I/O-free — the `OrchestratorService` shell supplies board rows + the event stream
 * and acts on the results. Unit-tested directly (high AI-testability per the lever, SP-tgsdvw);
 * the live SDK worker / advance is the shell's job — a human verdict (low AI-testability).
 *
 * The one I/O seam here is `runAcVerifications` (SP-tgzyfy / TEP-tgzx3p, the closing gate): it
 * spawns the Spec's declared per-AC checks. The actual spawn is behind an injectable `AcExec`
 * defaulting to `child_process` so the runner + the report builder stay unit-testable with fakes.
 */
import { spawn } from "child_process";

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
  depends_on?: string[];
  execution: "serial" | "mechanize" | "fan-out";
}

export interface ExecutionUnit {
  shape: "serial" | "mechanize" | "fan-out";
  units: WorkUnit[];
}

/**
 * Batch one slice's work units into **execution units** to amortize worker cold-start
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
  /** 1-based AC ordinals the slice `satisfies` — the closing gate (SP-tgzyfy) advances the slice
   *  to Done only when these ACs' verifications all ran green, then ticks exactly these on the Spec. */
  satisfies?: number[];
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
  // Pre-pass: the node ids each slice emits. A unit-less slice's node IS its
  // handle; a unit-bearing slice's nodes are `${handle}#eu-{i}`. This lets a
  // slice-level `depends_on` (a bare handle) be **expanded** to the dep-slice's
  // unit ids — a dependency on a slice means "wait for ALL its units." Without
  // this, a handle dep on a unit-bearing slice is unresolvable in the static DAG
  // (its nodes are `#eu-{i}`, never the bare handle) even though `readyFrontier`
  // resolves it at runtime via the done-set — the static/runtime asymmetry that
  // made `validateDag` false-reject a correctly-authored inter-slice dep
  // (TEP-th3i18 #18). Expansion is a no-op for a unit-less dep-slice (its id ==
  // its handle), so legacy slice graphs are unchanged.
  const eusBySlice = new Map<string, ExecutionUnit[]>();
  const nodeIdsBySlice = new Map<string, string[]>();
  for (const s of slices) {
    const units = s.workUnits ?? [];
    if (units.length === 0) {
      nodeIdsBySlice.set(s.handle, [s.handle]);
    } else {
      const eus = batchExecutionUnits(units);
      eusBySlice.set(s.handle, eus);
      nodeIdsBySlice.set(
        s.handle,
        eus.map((_, i) => `${s.handle}#eu-${i}`),
      );
    }
  }
  // A dep that names a slice handle becomes that slice's unit ids; a dep already
  // a unit id (or an unresolvable one — a footprint path / dangling handle) is
  // passed through so `validateDag` can flag it.
  const expand = (deps: string[]): string[] => [
    ...new Set(deps.flatMap((d) => nodeIdsBySlice.get(d) ?? [d])),
  ];

  const out: SchedUnit[] = [];
  for (const s of slices) {
    const sliceDeps = s.dependsOn ?? [];
    const units = s.workUnits ?? [];
    if (units.length === 0) {
      out.push({
        id: s.handle,
        slice: s.handle,
        footprint: s.files ?? [],
        dependsOn: expand(sliceDeps),
        shape: "serial",
      });
      continue;
    }
    eusBySlice.get(s.handle)!.forEach((eu, i) => {
      const footprint = [
        ...new Set(eu.units.flatMap((u) => u.footprint ?? [])),
      ];
      const dependsOn = expand([
        ...sliceDeps,
        ...eu.units.flatMap((u) => u.depends_on ?? []),
      ]);
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
export function buildWorkerPrompt(
  unit: SchedUnit,
  specNumber: string,
  context?: { specBody?: string; sliceBody?: string },
): string {
  const fp = unit.footprint.join(", ") || "(no declared footprint)";
  const task =
    unit.shape === "mechanize"
      ? `This is a MECHANIZE unit: author ONE transform and apply it across all of [${fp}] — do not hand-edit each object.`
      : unit.shape === "fan-out"
        ? `This is a FAN-OUT unit over [${fp}].${unit.note ? ` Task: ${unit.note}` : ""}`
        : `This is a SERIAL unit — do its steps in order over [${fp}].${unit.note ? ` Task: ${unit.note}` : ""}`;
  // The worker runs in a worktree of the CODE repo — the board/specs dir is NOT there. Embed the
  // spec + slice so it has full context inline rather than hunting the filesystem for a spec it
  // cannot reach.
  const specBlock = context?.specBody?.trim()
    ? `\n──── PARENT SPEC (SP-${specNumber}) ────\n${context.specBody.trim()}\n`
    : "";
  const sliceBlock = context?.sliceBody?.trim()
    ? `\n──── YOUR SLICE (${unit.slice}) ────\n${context.sliceBody.trim()}\n`
    : "";
  const hasCtx = specBlock || sliceBlock;
  return (
    `You are an autonomous Tandem worker for execution unit ${unit.id} of slice ${unit.slice}.\n` +
    `Implement THIS unit only — touch only its footprint: ${fp}.\n` +
    (hasCtx
      ? `The board/specs dir is NOT in this worktree; your spec + slice are embedded below — use them, don't search the filesystem for specs/.\n`
      : `(Read the parent spec/slice for context if available — note the specs dir may not be in this worktree.)\n`) +
    `\n${task}\n` +
    specBlock +
    sliceBlock +
    `\nWork autonomously to the slice's acceptance criteria above. Make reasonable engineering decisions and do NOT ask for confirmation. ` +
    `Do NOT commit, run git, or move the board card — the orchestrator owns git and the gate. ` +
    `Only if you hit a genuine decision you cannot make from the spec/slice/codebase, output a single final message that begins with ${NEEDS_INPUT_SENTINEL} followed by your question, then stop — never guess.`
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
  /** The shell/playbook command run in the worktree (exit 0 = the AC passed). */
  run: string;
  /** Where it runs — informational; the live cluster run is the shell's job (low AI-testability). */
  env?: "cluster" | "local";
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
    if (typeof run !== "string" || !run.trim()) continue;
    const env = (val as Record<string, unknown>).env;
    out.push({
      ac,
      run: run.trim(),
      env: env === "cluster" || env === "local" ? env : undefined,
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

const defaultAcExec: AcExec = (run, cwd) =>
  new Promise((resolve, reject) => {
    const proc = spawn(run, { cwd, shell: true });
    let output = "";
    proc.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, output }));
  });

/** Format one verification's evidence: the command, its exit code, and a clipped output tail. */
function acEvidence(run: string, code: number | null, output: string): string {
  const tail = output
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l, i, a) => l.length > 0 || i < a.length - 1)
    .slice(-8)
    .join("\n")
    .trim();
  const head = `$ ${run} → exit ${code ?? "null"}`;
  return tail ? `${head}\n${clip(tail, 600)}` : head;
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
): Promise<AcResult[]> {
  const out: AcResult[] = [];
  for (const v of verifs) {
    try {
      const { code, output } = await exec(v.run, cwd);
      out.push({
        ac: v.ac,
        pass: code === 0,
        evidence: acEvidence(v.run, code, output),
      });
    } catch (err) {
      out.push({
        ac: v.ac,
        pass: false,
        evidence: `$ ${v.run} → could not run: ${(err as Error).message}`,
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

/** One execution unit's outcome, for the delivery report's per-unit table. */
export interface ReportUnit {
  id: string;
  outcome: "success" | "needs-input" | "failed";
}

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
}

/**
 * Build the auditable delivery report (DELIVERY.md) — the durable, non-ephemeral record the
 * closing gate writes on EVERY completion (pass or fail): the commit, each execution unit's
 * outcome, the caught problems, and — the SP-tgzyfy addition — a **per-AC pass/fail table with
 * its verification evidence**, so a completed Spec carries proof of *how* each AC was verified
 * (and a failed one carries proof of *why* it stalled). Pure → unit-tested.
 */
export function buildDeliveryReport(i: DeliveryReportInput): string {
  const glyph = (o: ReportUnit["outcome"]) =>
    o === "success" ? "✓" : o === "needs-input" ? "❓" : "✗";
  const units = i.units.length
    ? i.units
        .map((u) => `| \`${u.id}\` | ${glyph(u.outcome)} ${u.outcome} |`)
        .join("\n")
    : "| — | (none) |";
  const fileList = i.files.length
    ? i.files.map((f) => `- \`${f}\``).join("\n")
    : "- (none)";

  const resultFor = new Map(i.acResults.map((r) => [r.ac, r]));
  const acRows = i.declared.length
    ? i.declared
        .map((v) => {
          const r = resultFor.get(v.ac);
          const verdict = !r ? "· not run" : r.pass ? "✓ pass" : "✗ fail";
          return `| #${v.ac} | \`${v.run.replace(/\|/g, "\\|")}\` | ${v.env ?? "—"} | ${verdict} |`;
        })
        .join("\n")
    : null;
  const acEvidenceBlocks = i.acResults.length
    ? i.acResults
        .map(
          (r) =>
            `**AC #${r.ac}** — ${r.pass ? "✓ pass" : "✗ fail"}\n\n\`\`\`\n${r.evidence}\n\`\`\``,
        )
        .join("\n\n")
    : "";

  const verifySection = acRows
    ? [
        "## Acceptance-criteria verification",
        "",
        "| AC | Verified by | Env | Result |",
        "| --- | --- | --- | --- |",
        acRows,
        "",
        acEvidenceBlocks,
      ]
    : [
        "## Acceptance-criteria verification",
        "",
        "**No `ac_verifications` declared on the Spec — the closing gate could not run.** " +
          "The acceptance criteria were NOT verified; the Spec is left `requires-attention` " +
          "(no skip, TEP-tgzx3p). Declare a per-AC verification map on the Spec, then re-run.",
      ];

  const problems = (i.problems ?? []).filter(Boolean);
  const problemSection = problems.length
    ? ["## Caught problems", "", ...problems.map((p) => `- ${p}`), ""]
    : [];

  return [
    `# Delivery — SP-${i.specNumber}`,
    "",
    `Orchestrated to branch \`spec/SP-${i.specNumber}\`${i.sha ? ` at \`${i.sha}\`` : ""}. ` +
      `${i.advanced.length} slice(s) advanced to Done; ${i.units.length} execution unit(s) ran` +
      `${i.committed ? " — committed ✓" : " — not committed"}.`,
    "",
    "## Execution units",
    "",
    "| Unit | Outcome |",
    "| --- | --- |",
    units,
    "",
    ...verifySection,
    "",
    ...problemSection,
    `## Files (${i.files.length})`,
    "",
    fileList,
    "",
    "## Next",
    "",
    i.committed
      ? `1. Review the \`spec/SP-${i.specNumber}\` branch (the committed change) — the per-AC table above is the evidence.\n` +
        `2. **Accept** to merge the Spec to \`main\` (gated on every AC checked), or **Reject** to open a primed session.`
      : `1. The closing gate did not pass — see the per-AC table / caught problems above.\n` +
        `2. Resolve the requires-attention slice(s), then re-run the orchestrator.`,
    "",
  ].join("\n");
}
