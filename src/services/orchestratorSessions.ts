/**
 * Live orchestrator-session registry (SP-tgs8nz SL-4). Tracks which slices have a live
 * `claude -p` worker and where each worker's stream is persisted as a `.jsonl`, and emits a
 * `change` event so the kanban panel can flag running nodes on the graph and float a session
 * out. In-process singleton — the `OrchestratorService` writes it; the panel reads + subscribes.
 */
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

const emitter = new EventEmitter();
const running = new Set<string>(); // slice handles with a live worker right now
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

/** The persisted `.jsonl` path for a slice (running or finished), if any. */
export function sessionLogPath(handle: string): string | undefined {
  return logs.get(handle);
}

/** Subscribe to running-set changes; returns an unsubscribe. */
export function onSessionsChange(cb: () => void): () => void {
  emitter.on("change", cb);
  return () => emitter.off("change", cb);
}
