// Pinned, decoupled worker model (SP-17/1) — the ONE place the worker model resolves.
//
// Every orchestrated Agent SDK worker (code/test-author, assessor, judge, acceptance-auditor) must
// run on an EXPLICITLY configured model rather than inheriting the session/environment default
// (`ANTHROPIC_MODEL` — whatever strong model drives the pairing session). This module is that pure,
// vscode-free, env-free resolver: the settings are read once at the extension-host boundary
// (`src/commands/orchestrate.ts`) into a {@link WorkerModelConfig}, and each worker spawn resolves its
// model here. The single named default (`"sonnet"`) lives ONLY here — it is a deliberate constant, never
// a silent fallback to an ambient/session value, and this module never reads `process.env`.

/** Operator-facing worker-model configuration, assembled from the two `thinkube.orchestrator` settings.
 *  Both fields optional so a repo that configures nothing still resolves (to the `"sonnet"` default). */
export interface WorkerModelConfig {
  /** The base worker model every role resolves to when its role has no override. */
  workerModel?: string;
  /** Optional per-role refinement — RAISES an individual role (e.g. `judge`, `assessor`) to a stronger
   *  model when an operator chooses to. It is never the mechanism by which a role gets a model (the base
   *  always resolves); it only overrides one. */
  workerModelByRole?: Record<string, string>;
}

/**
 * Resolve the model for a worker of role `role` (SP-17/1). Pure and env-independent: identical inputs →
 * identical output, and it NEVER reads `process.env` (so it is decoupled from `ANTHROPIC_MODEL`). A
 * per-role override wins; otherwise the configured base model; otherwise the named default `"sonnet"`.
 */
export function resolveWorkerModel(
  config: WorkerModelConfig,
  role?: string,
): string {
  return (
    (role !== undefined ? config.workerModelByRole?.[role] : undefined) ??
    config.workerModel ??
    "sonnet"
  );
}
