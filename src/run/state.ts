/**
 * Live state of one TEP run: per-unit states, the logs, parked workers
 * awaiting an answer, and the abort registry. The panel renders this; the
 * dispatcher mutates it and emits on every change.
 *
 * Every step keeps its OWN log and the surface reads it a page at a time, so
 * a failed step is diagnosed where it failed instead of from one shared ring
 * that has already dropped the line that mattered.
 */

/**
 * Where a unit got to. `blocked` is not a failure: it is a unit that
 * never ran, because the run stopped or something it waits on failed.
 * Calling that failed says the worker was tried and did badly, which is
 * the opposite of what happened, and it buries the one unit that really
 * did fail among a dozen that never started.
 */
export type UnitState = "ready" | "running" | "parked" | "done" | "failed" | "blocked";

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

export class RunState {
  units = new Map<string, RunUnitView>();
  logs: string[] = [];
  /** step id → its own lines. "run" holds what belongs to no single step. */
  stepLogs = new Map<string, string[]>();
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
    },
    onChange: () => void,
  ): RunState {
    const s = new RunState(onChange);
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

  log(line: string, step = "run"): void {
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
  /** The tail of a step's log, and how many lines there are in all. */
  logTail(step: string): { lines: string[]; total: number; shown: number } {
    const all = this.stepLogs.get(step) ?? [];
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
  } {
    return {
      units: [...this.units.values()],
      logs: this.logs.slice(-40),
      logCounts: Object.fromEntries([...this.stepLogs].map(([k, v]) => [k, v.length])),
      parked: [...this.parked.entries()].map(([unitId, p]) => ({ unitId, question: p.question })),
      sliceChecks: Object.fromEntries([...this.sliceChecks].map(([k, v]) => [k, [...v]])),
      ...(this._runId ? { runId: this._runId } : {}),
    };
  }
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
