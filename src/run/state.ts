/**
 * Live state of one TEP run: per-unit states, the log ring, parked workers
 * awaiting an answer, and the abort registry. The panel renders this; the
 * dispatcher mutates it and emits on every change.
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
}

export class RunState {
  units = new Map<string, RunUnitView>();
  logs: string[] = [];
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

  log(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
    this.onChange();
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

  view(): { units: RunUnitView[]; logs: string[]; parked: { unitId: string; question: string }[] } {
    return {
      units: [...this.units.values()],
      logs: this.logs.slice(-40),
      parked: [...this.parked.entries()].map(([unitId, p]) => ({ unitId, question: p.question })),
    };
  }
}
