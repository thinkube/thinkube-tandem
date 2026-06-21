/**
 * Live orchestrator-session registry (SP-tgs8nz SL-4). Tracks which slices have a live
 * Agent SDK worker and where each worker's stream is persisted as a `.jsonl`, and emits a
 * `change` event so the kanban panel can flag running nodes on the graph and float a session
 * out. In-process singleton — the `OrchestratorService` writes it; the panel reads + subscribes.
 */
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

const emitter = new EventEmitter();
const running = new Set<string>(); // slice handles with a live worker right now
const doneUnits = new Set<string>(); // unit ids that completed successfully in the current run
const logs = new Map<string, string>(); // handle → persisted .jsonl path (kept after the worker ends)
let baseDir: string | undefined;

/** Set the directory where session `.jsonl` logs are written (called once at activation). */
export function initSessions(dir: string): void {
  baseDir = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
}

/** Mark a slice's worker live; returns the `.jsonl` path to stream into (undefined if no dir). */
export function startSession(handle: string): string | undefined {
  const logPath = baseDir
    ? path.join(baseDir, `${handle.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`)
    : undefined;
  if (logPath) {
    logs.set(handle, logPath);
    try {
      fs.writeFileSync(logPath, "");
    } catch {
      /* best-effort */
    }
  }
  running.add(handle);
  doneUnits.delete(handle); // a (re)starting unit is no longer "done"
  emitter.emit("change");
  return logPath;
}

/** Append a raw stream chunk to a slice's session log (no-op if uninitialized). */
export function appendSession(handle: string, chunk: string): void {
  const logPath = logs.get(handle);
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, chunk);
  } catch {
    /* best-effort */
  }
}

/** Mark a slice's worker finished — its log file persists for later viewing. */
export function endSession(handle: string): void {
  if (running.delete(handle)) emitter.emit("change");
}

/** Slice handles with a live worker right now. */
export function runningSessions(): string[] {
  return [...running];
}

/** Mark a unit completed successfully — the graph shows its node done (lime) until the next
 *  run re-dispatches it. A finished unit drops out of the running set, so without this it would
 *  fall back to its slice's status (still "ready" mid-run) and revert to the idle/dashed style. */
export function markUnitDone(id: string): void {
  running.delete(id);
  if (!doneUnits.has(id)) {
    doneUnits.add(id);
    emitter.emit("change");
  }
}

/** Unit ids that completed successfully in the current run (for the graph's done nodes). */
export function doneWorkers(): string[] {
  return [...doneUnits];
}

/** The persisted `.jsonl` path for a slice (running or finished), if any. */
export function sessionLogPath(handle: string): string | undefined {
  return logs.get(handle);
}

/** Subscribe to running-set changes; returns an unsubscribe. */
export function onSessionsChange(cb: () => void): () => void {
  emitter.on("change", cb);
  return () => emitter.off("change", cb);
}

// ── Parked workers (SP-tgs8nz_SL-3: resident needs-input standby) ───────────
//
// A worker that asks a question stays **resident** (its streaming-input SDK
// session alive, suspended awaiting the answer) but off the active cap. It
// registers here so `/attend` — a separate command, possibly a different
// OrchestratorService instance — can push the answer into the live session.

interface ParkedWorker {
  slice: string;
  question: string;
  /** Resolve the worker's suspended input generator with the human's answer. */
  answer: (a: string) => void;
}
const parked = new Map<string, ParkedWorker>(); // unit id → parked worker

/** Park a resident worker awaiting an answer (frees its active slot; stays alive). */
export function parkWorker(
  id: string,
  slice: string,
  question: string,
  answer: (a: string) => void,
): void {
  parked.set(id, { slice, question, answer });
  emitter.emit("change");
}

/** Push the human's answer into a parked worker's live session; true if it was resident. */
export function answerParkedWorker(id: string, answer: string): boolean {
  const p = parked.get(id);
  if (!p) return false;
  parked.delete(id);
  p.answer(answer);
  emitter.emit("change");
  return true;
}

/** Drop a parked worker (it completed or was abandoned). */
export function unparkWorker(id: string): void {
  if (parked.delete(id)) emitter.emit("change");
}

/** Currently parked workers (for the control-center graph's needs-input nodes). */
export function parkedWorkers(): Array<{ id: string; slice: string; question: string }> {
  return [...parked.entries()].map(([id, p]) => ({
    id,
    slice: p.slice,
    question: p.question,
  }));
}
