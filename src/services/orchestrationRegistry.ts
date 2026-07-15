/**
 * Live orchestration runs, keyed by composite spec id (`t/n`). One run per
 * Spec (the dispatch lock enforces it), so a Stop can target exactly the run
 * the human means — the per-spec webview button, the status-bar aggregate, and
 * the palette command all resolve their target here instead of broadcasting a
 * halt to every orchestrator in flight (the 2026-07-15 shotgun bug).
 *
 * Module-scope on purpose: the service is constructed per invocation, so a
 * shared registry is the only handle a palette command or a kanban panel has.
 */
import type { OrchestratorService } from "./OrchestratorService";

const runs = new Map<string, OrchestratorService>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

/** Record a run as in flight. Overwrites are impossible in practice (dispatch lock). */
export function startRun(spec: string, orchestrator: OrchestratorService): void {
  runs.set(spec, orchestrator);
  emit();
}

/** Drop a finished run (called from the dispatch `finally`). */
export function endRun(spec: string): void {
  if (runs.delete(spec)) emit();
}

/** The orchestrator behind a specific in-flight run, if any. */
export function getRun(spec: string): OrchestratorService | undefined {
  return runs.get(spec);
}

/** Composite spec ids (`t/n`) with a run in flight, insertion-ordered. */
export function runningRunSpecs(): string[] {
  return [...runs.keys()];
}

/** Subscribe to registry changes; returns the unsubscribe function
 *  (same shape as `onSessionsChange`). */
export function onRunsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
