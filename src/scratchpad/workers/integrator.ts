/**
 * Integrator worker — pre-gated with GATES.integrator.
 * allowed: [editSection, setSectionState, addNote]
 * disallowed: [freeze, writeArtifact]
 *
 * Re-exported from workers/worker.ts; this file allows direct imports from
 * workers/integrator as well.
 */
export { integrator } from "./worker";
export type { WorkerFactoryDeps, WorkerRun } from "./worker";
