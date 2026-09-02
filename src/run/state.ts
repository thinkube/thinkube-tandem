/**
 * Live state of one TEP run: per-unit states, the logs, parked workers
 * awaiting an answer, and the abort registry. The panel renders this; the
 * dispatcher mutates it and emits on every change.
 *
 * Every step keeps its OWN log and the surface reads it a page at a time, so
 * a failed step is diagnosed where it failed instead of from one shared ring
 * that has already dropped the line that mattered.
 */
import * as path from "node:path";
import type { Cut, Delivery, ProofAnchor, Ruling, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";
import type { DispatchDeps } from "./deps";
import type { Exec } from "./oracle";
import type { BoundedExec } from "./setup";
import type { RunWorkerDeps, WorkerOutcome } from "./worker";
import type { Proved } from "./proved";

/**
 * Where a unit got to. `blocked` is not a failure: it is a unit that
 * never ran, because the run stopped or something it waits on failed.
 * Calling that failed says the worker was tried and did badly, which is
 * the opposite of what happened, and it buries the one unit that really
 * did fail among a dozen that never started.
 */
export type UnitState = "ready" | "running" | "parked" | "done" | "failed" | "blocked";

/**
 * A phase of the run that is not a worker: the door before the first unit
 * and the delivery after the gate. Drawn as a card like every other step,
 * with a state, what it is doing now, and its own log under its name.
 */
export interface PhaseView {
  state: "pending" | "running" | "done" | "failed";
  /** What it is doing, or why it ended the way it did. */
  doing?: string;
  since?: number;
}
export type PhaseName = "door" | "delivery";

export interface RunUnitView {
  /** What this unit builds — the sentences, where they land, what proves
   *  them. Set when the run is planned, never changed by what happens. */
  what?: string;
  id: string;
  slice: string;
  role: "code" | "test" | "maintain";
  state: UnitState;
  /** Unit ids this unit waits on — the run graph's edges. */
  requires: string[];
  /** WHY it waits, per edge. Two very different things end up in
   *  `requires`: a cross-slice dependency on work another slice alone
   *  produces, and the same-slice rule that a coder starts only once its
   *  probes exist. Drawn as one arrow they read the same, and only one of
   *  them is a coupling worth questioning. */
  waits?: { on: string; kind: "needs" | "probes"; what?: string }[];
  /** Epoch ms when the unit started running — the surface renders elapsed. */
  startedAt?: number;
  question?: string;
  /** Why this unit failed, in the words the worker or the gate reported. */
  note?: string;
  /** What the unit is doing or waiting on right now, and since when — the
   *  card says "waiting on verify — round 3, 4m" instead of "running". */
  activity?: { text: string; since: number };
}

/**
 * How much of a step's log travels to the surface.
 *
 * A log is read the way a terminal is read: it scrolls. It was paged
 * instead, eighteen lines at a time, for a reason that was never the
 * reader's — sending two thousand lines on every push, and a run pushes
 * constantly, is a great deal of data for a channel that carries the
 * whole space. So the tail travels, deep enough to scroll back through,
 * and the count says what is not being shown.
 */
const LOG_TAIL = 500;
/** Lines kept per step. Generous: a step's log is the evidence it failed. */
const STEP_LOG_CAP = 2000;

/** A step's own sub-steps, keyed by the "<step>#<name>" convention (e.g.
 *  "gate#closer", "gate#finisher") — every key logged under this run that
 *  belongs to `step` but is not `step` itself, in the order they first
 *  appear. One rule, read by `logTail` and `view()` alike, so a step's
 *  account and its line count never disagree about what belongs to it. */
function subStepsOf(stepLogs: Map<string, string[]>, step: string): string[] {
  const prefix = `${step}#`;
  return [...stepLogs.keys()].filter((k) => k.startsWith(prefix));
}

export class RunState {
  units = new Map<string, RunUnitView>();
  logs: string[] = [];
  /** step id → its own lines. "run" holds what belongs to no single step. */
  stepLogs = new Map<string, string[]>();
  phases: Record<PhaseName, PhaseView> = { door: { state: "pending" }, delivery: { state: "pending" } };
  /** Where a line with no step of its own is filed: the phase in progress. */
  phaseStep: "door" | "run" | "delivery" = "door";
  parked = new Map<string, { question: string; answer: (a: string) => void }>();
  aborts = new Map<string, AbortController>();
  halted = false;
  /** What the door judged: footprints and order, kept so the plan can be
   *  re-judged against a changed door without running anything. */
  plan?: { handle: string; criterionIds?: string[]; units: { role?: string; footprint: string[]; consumes?: string[] }[] }[];
  /** Per-slice, which acceptance criteria passed and which did not — the
   *  audit card's own account. A slice's outcomes are replaced whole on
   *  every grading, never appended to: a re-grade reports the current
   *  state of the criteria, not their history. */
  sliceChecks = new Map<string, { ac: number; pass: boolean; text?: string }[]>();
  /** This run's own id — the same id that will land on the delivery it
   *  mints, so the person watching the run can match it against the report. */
  private _runId?: string;

  constructor(private onChange: () => void) {}

  /** A finished run, read back from disk: the same state, with nothing
   *  live in it — no aborts to cancel and nobody left to answer. */
  static from(
    record: {
      units: RunUnitView[];
      logs: string[];
      stepLogs: Record<string, string[]>;
      runId?: string;
      sliceChecks?: Record<string, { ac: number; pass: boolean; text?: string }[]>;
      phases?: Record<PhaseName, PhaseView>;
    },
    onChange: () => void,
  ): RunState {
    const s = new RunState(onChange);
    if (record.phases) s.phases = { door: { ...record.phases.door }, delivery: { ...record.phases.delivery } };
    s.phaseStep = "delivery";
    for (const u of record.units) s.units.set(u.id, { ...u, question: undefined });
    s.logs = [...record.logs];
    s.stepLogs = new Map(Object.entries(record.stepLogs).map(([k, v]) => [k, [...v]]));
    s._runId = record.runId;
    if (record.sliceChecks)
      s.sliceChecks = new Map(Object.entries(record.sliceChecks).map(([k, v]) => [k, [...v]]));
    return s;
  }

  /** Name this run with the id that will land on its delivery. */
  setRunId(id: string): void {
    this._runId = id;
    this.onChange();
  }

  seed(
    id: string,
    slice: string,
    role: "code" | "test" | "maintain",
    requires: string[] = [],
    /** What this unit is here to build, in the words the reading used —
     *  a card that names only itself tells a reader nothing. */
    what?: string,
    waits: { on: string; kind: "needs" | "probes"; what?: string }[] = [],
  ): void {
    this.units.set(id, {
      id,
      slice,
      role,
      state: "ready",
      requires,
      ...(what ? { what } : {}),
      ...(waits.length ? { waits } : {}),
    });
    this.onChange();
  }

  /** Never ran: the run stopped, or something it waits on failed. */
  block(id: string, why: string): void {
    const u = this.units.get(id);
    if (!u || u.state === "done" || u.state === "failed") return;
    u.state = "blocked";
    u.note = why;
    this.onChange();
  }

  set(id: string, state: UnitState, question?: string): void {
    const u = this.units.get(id);
    if (!u) return;
    if (state === "running" && u.state !== "parked") u.startedAt = Date.now();
    // A failure with nothing said reads exactly like work that was judged
    // and did not pass, and its promise is counted unkept for a reason
    // nobody can see. Blocked units say the run stopped; a failed one that
    // says nothing is worse than either, so silence is named as what it is.
    if (state === "failed" && !u.note)
      u.note = "the run failed this unit without saying why — a fault in the machine, not a verdict on the work";
    u.state = state;
    u.question = state === "parked" ? question : undefined;
    if (state !== "running" && state !== "parked") u.activity = undefined;
    this.onChange();
  }

  /** A phase moves: its state, and what it is doing or why it ended. Lines
   *  with no step of their own are filed under the phase in progress. */
  phase(name: PhaseName, state: PhaseView["state"], doing?: string): void {
    const p = this.phases[name];
    const moved = p.state !== state || p.doing !== doing;
    p.state = state;
    p.doing = doing;
    if (state === "running" && (moved || !p.since)) p.since = Date.now();
    if (name === "door" && state !== "running") this.phaseStep = state === "done" ? "run" : "door";
    if (name === "delivery" && state === "running") this.phaseStep = "delivery";
    this.onChange();
  }

  /** What a unit is doing or waiting on right now; empty clears it. */
  doing(id: string, text: string | undefined): void {
    const u = this.units.get(id);
    if (!u) return;
    if (text) {
      if (u.activity?.text !== text) u.activity = { text, since: Date.now() };
    } else u.activity = undefined;
    this.onChange();
  }

  /** A failure that cannot say why is a failure the human cannot act on. */
  fail(id: string, why: string): void {
    const u = this.units.get(id);
    if (!u) return;
    u.state = "failed";
    u.note = why;
    this.onChange();
  }

  /** A line for the whole run, and for the step it belongs to when known. */
  /** Where every line also goes, as it happens: the run's own log on disk.
   *  A log that lives only in a window cannot be read while the run is in
   *  flight, which is exactly when it is needed. */
  sink?: (line: string, step: string) => void;

  /**
   * Every line goes two places, always: the run-wide log the bottom panel
   * renders, AND the step it belongs to. Filing a line under a step is
   * never a way of taking it out of the run's own account — a line written
   * under "gate", or under a sub-step like "gate#closer", is still one of
   * the run's lines, and a reader watching the whole run must see it
   * without knowing which step wrote it.
   */
  log(line: string, step?: string): void {
    // A line with no step of its own belongs to the phase in progress: the
    // door's lines under "door", the run's under "run", the hand-over's
    // under "delivery" — so each has a card, and each card has its log.
    step = step ?? this.phaseStep;
    // A phase's card says what it is doing now: its latest line, while it
    // is the phase in progress.
    if ((step === "door" || step === "delivery") && this.phases[step].state === "running")
      this.phases[step].doing = line.replace(/^[^:]{1,24}:\s+/, "").trim().slice(0, 110);
    this.sink?.(line, step);
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
    const own = this.stepLogs.get(step) ?? [];
    own.push(line);
    if (own.length > STEP_LOG_CAP) own.shift();
    this.stepLogs.set(step, own);
    this.onChange();
  }

  /** One page of a step's own log, newest page by default. */
  /** The tail of a step's log — its own lines, then every sub-step's, in
   *  the order the sub-steps were first written to — and how many lines
   *  there are in all. Asking for a step is asking for everything it did,
   *  including what it delegated: "gate" reads as one account, not an
   *  empty panel next to "gate#closer" holding the actual work. */
  logTail(step: string): { lines: string[]; total: number; shown: number } {
    const own = this.stepLogs.get(step) ?? [];
    const all = [...own, ...subStepsOf(this.stepLogs, step).flatMap((s) => this.stepLogs.get(s) ?? [])];
    const lines = all.slice(-LOG_TAIL);
    return { lines, total: all.length, shown: lines.length };
  }

  park(id: string, question: string, answer: (a: string) => void): void {
    this.parked.set(id, { question, answer });
    this.set(id, "parked", question);
  }

  answer(id: string, text: string): boolean {
    const p = this.parked.get(id);
    if (!p) return false;
    this.parked.delete(id);
    this.set(id, "running");
    p.answer(text);
    return true;
  }

  /** Record what a slice's checks came back as, replacing whatever this
   *  slice held before — a re-grade reports where the slice stands now. */
  gradeSlice(slice: string, checks: { ac: number; pass: boolean; text?: string }[]): void {
    this.sliceChecks.set(slice, [...checks]);
    this.onChange();
  }

  halt(): number {
    this.halted = true;
    let n = 0;
    for (const [, c] of this.aborts) {
      c.abort();
      n++;
    }
    this.aborts.clear();
    this.onChange();
    return n;
  }

  view(): {
    units: RunUnitView[];
    logs: string[];
    parked: { unitId: string; question: string }[];
    /** How many lines each step holds — the surface pages them on demand. */
    logCounts: Record<string, number>;
    /** This run's own id, once named — the same id its delivery will carry. */
    runId?: string;
    /** Per-slice acceptance-criteria outcomes, from the last grading. */
    sliceChecks: Record<string, { ac: number; pass: boolean; text?: string }[]>;
    /** The door and the delivery: the run's two phases that are not workers. */
    phases: Record<PhaseName, PhaseView>;
  } {
    return {
      units: [...this.units.values()],
      phases: { door: { ...this.phases.door }, delivery: { ...this.phases.delivery } },
      logs: this.logs.slice(-40),
      // A parent's count includes what its sub-steps wrote — the same fold
      // `logTail` gives its lines, so the number on a card and the log a
      // click on it opens are never about two different sets of lines.
      logCounts: Object.fromEntries(
        [...this.stepLogs].map(([k, v]) => [
          k,
          v.length + subStepsOf(this.stepLogs, k).reduce((n, s) => n + (this.stepLogs.get(s)?.length ?? 0), 0),
        ]),
      ),
      parked: [...this.parked.entries()].map(([unitId, p]) => ({ unitId, question: p.question })),
      sliceChecks: Object.fromEntries([...this.sliceChecks].map(([k, v]) => [k, [...v]])),
      ...(this._runId ? { runId: this._runId } : {}),
    };
  }
}

/**
 * What one run is called and where it works: the id heading its rows in the
 * log, the produced-at stamp its delivery carries, its branch, and the
 * worktree it runs in.
 *
 * One reading of the clock mints both facts. Two separate reads could
 * straddle a tick and name two moments as if they were one — the run's log
 * would then head its rows with an id its own delivery does not carry.
 *
 * Kept beside {@link RunState} rather than in `dispatch.ts`, which the run
 * loop itself already fills to the repository's module-size limit.
 */
export function runNaming(a: {
  tep: string;
  repoRoot: string;
  projectId?: string;
  nowMs: number;
}): {
  runId: string;
  producedAt: string;
  runName: string;
  branch: string;
  wtRoot: string;
  wtName: string;
  worktree: string;
} {
  const producedAt = new Date(a.nowMs).toISOString();
  // One run's rows, apart from the next run of this cut.
  const runId = `${a.tep}@${a.nowMs.toString(36)}`;
  const runName = a.projectId ? `${a.projectId}/${a.tep}` : a.tep;
  const wtRoot = path.join(path.dirname(a.repoRoot), `${path.basename(a.repoRoot)}-worktrees`);
  const wtName = runName.replace(/\//g, "__");
  return {
    runId,
    producedAt,
    runName,
    branch: `tandem/${runName}`,
    wtRoot,
    wtName,
    worktree: path.join(wtRoot, wtName),
  };
}

/**
 * The run's heartbeat verdict: a run that has written nothing to its record
 * for longer than the longest thing it is allowed to do silently declares
 * itself dead AT ITS LAST NAMED STEP — a silent stall is a failure with a
 * name, never three quiet hours.
 */
export function silentVerdict(a: {
  running: boolean;
  lastBeatMs: number;
  nowMs: number;
  /** The longest legitimate quiet stretch (the suite's own bound, plus slack). */
  limitMs: number;
  lastLine?: string;
  busyUnits?: readonly { id: string; text?: string }[];
}): string | undefined {
  if (!a.running || a.nowMs - a.lastBeatMs < a.limitMs) return undefined;
  const mins = Math.round((a.nowMs - a.lastBeatMs) / 60000);
  const at =
    a.busyUnits?.length
      ? a.busyUnits.map((u) => `${u.id}${u.text ? ` (${u.text})` : ""}`).join("; ")
      : (a.lastLine ?? "an unnamed step");
  return `the run went silent for ${mins} minutes at: ${at.slice(0, 300)} — stopped and recorded`;
}

/** What a run hands back: the delivery it opened or withheld, and every
 *  refusal and undelivered obligation along the way. Kept beside
 *  {@link RunState} rather than in `dispatch.ts`, which the run loop
 *  itself already fills to the repository's module-size limit. */
export interface DispatchOutcome {
  delivery?: Delivery;
  refusals: string[];
  undelivered: string[];
  url?: string;
  /** Where each criterion's standing check went on living — bound onto the acceptance criteria. */
  proofAnchors?: (ProofAnchor & { criterionId: string })[];
}

/** Everything the closing gate needs: the run's own facts, what the door
 *  proved, and the seams — exec, log, defect — through which it acts.
 *  Kept beside {@link RunState} rather than in `gate.ts` itself, which the
 *  gate's own logic already fills to the repository's module-size limit. */
export interface GateContext {
  tep: string;
  /** This run's own id and the moment it was minted — one clock reading in
   *  `dispatchTep`, stamped on every delivery this gate hands back, kept or
   *  withheld. Optional only for a caller that predates the field —
   *  `dispatchTep` always supplies both from its own single clock read. */
  runId?: string;
  producedAt?: string;
  /** Ran one of this repository's own tests here — the promise veto rests
   *  on it, so the gate is given what the door proved, never a candidate. */
  runOne: Proved;
  /** Per-part single-check commands, so a check is run by the runner of
   *  the part that owns it — the gate judges the same way the slices did. */
  parts?: Record<string, { runOne?: string }>;
  /** Ran this repository's whole suite here — or absent, when no such
   *  command runs in a worktree. Absent removes the standing-suite veto,
   *  exactly as no product build removes that one; the door has already
   *  said so, and the delivery says it again where the verdict would be.
   *  What is never allowed is an empty string reaching a shell. */
  suite?: Proved;
  branch: string;
  baseSha: string;
  worktree: string;
  slices: SliceForDag[];
  space: Space;
  cut: Cut;
  deps: DispatchDeps;
  sliceProbes: Map<string, string[]>;
  sliceCommitted: Set<string>;
  checkOf: Map<string, string>;
  undelivered: string[];
  rulings: Ruling[];
  decisions: { unit: string; text: string }[];
  exec: Exec;
  boundedExec: BoundedExec;
  /** Runs the suite command, bounded for a whole suite. */
  suiteExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  state: RunState;
  /** The session a unit was worked in, when the run still holds it. */
  sessionOf: (unit: string) => string | undefined;
  /** The run's worker, so a repair is the next message in that session. */
  worker: (deps: RunWorkerDeps, brief: string) => Promise<WorkerOutcome>;
  /** How many times this run made a person interpret the machine. */
  machineAttention: () => number;
  /** Work a fenced unit wrote that the guard took back, with its change —
   *  read by the last actor, which is fenced by nothing. */
  restored?: readonly { path: string; patch: string }[];
  /** The run's door, so an author repairing at the gate can be cleared for
   *  a file nobody is contending — at the gate, nobody is. */
  clearFor?: (paths: string[]) => Promise<{ granted: string[]; refused: { path: string; why: string }[] }>;
  log: (line: string, step?: string) => void;
  defect: (entry: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    qualifier?: string;
    /** Which stage a repair implicates (docs/TARGET.md §4). */
    stage?: "author" | "brief" | "check" | "clearance" | "altitude";
    impact: string;
    detail: string;
  }) => void;
}
