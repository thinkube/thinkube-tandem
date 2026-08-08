/**
 * Live state of one TEP run: per-unit states, the logs, parked workers
 * awaiting an answer, and the abort registry. The panel renders this; the
 * dispatcher mutates it and emits on every change.
 *
 * Every step keeps its OWN log and the surface reads it a page at a time, so
 * a failed step is diagnosed where it failed instead of from one shared ring
 * that has already dropped the line that mattered.
 */

export type UnitState = "ready" | "running" | "parked" | "done" | "failed";

export interface RunUnitView {
  id: string;
  slice: string;
  role: "code" | "test";
  state: UnitState;
  /** Unit ids this unit waits on — the run graph's edges. */
  requires: string[];
  /** Epoch ms when the unit started running — the surface renders elapsed. */
  startedAt?: number;
  question?: string;
  /** Why this unit failed, in the words the worker or the gate reported. */
  note?: string;
}

/** How many lines one page of a step's log carries. */
const LOG_PAGE = 18;
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

  constructor(private onChange: () => void) {}

  seed(id: string, slice: string, role: "code" | "test", requires: string[] = []): void {
    this.units.set(id, { id, slice, role, state: "ready", requires });
    this.onChange();
  }

  set(id: string, state: UnitState, question?: string): void {
    const u = this.units.get(id);
    if (!u) return;
    if (state === "running" && u.state !== "parked") u.startedAt = Date.now();
    u.state = state;
    u.question = state === "parked" ? question : undefined;
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
  log(line: string, step = "run"): void {
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
    const own = this.stepLogs.get(step) ?? [];
    own.push(line);
    if (own.length > STEP_LOG_CAP) own.shift();
    this.stepLogs.set(step, own);
    this.onChange();
  }

  /** One page of a step's own log, newest page by default. */
  logPage(step: string, page?: number): { lines: string[]; page: number; pages: number; total: number; pageSize: number } {
    const all = this.stepLogs.get(step) ?? [];
    const pages = Math.max(1, Math.ceil(all.length / LOG_PAGE));
    const at = Math.min(Math.max(page ?? pages - 1, 0), pages - 1);
    return {
      lines: all.slice(at * LOG_PAGE, at * LOG_PAGE + LOG_PAGE),
      page: at,
      pages,
      total: all.length,
      pageSize: LOG_PAGE,
    };
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
  } {
    return {
      units: [...this.units.values()],
      logs: this.logs.slice(-40),
      logCounts: Object.fromEntries([...this.stepLogs].map(([k, v]) => [k, v.length])),
      parked: [...this.parked.entries()].map(([unitId, p]) => ({ unitId, question: p.question })),
    };
  }
}
