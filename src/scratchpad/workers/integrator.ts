/**
 * Integrator worker — pre-gated with GATES.integrator.
 * allowed: [proposeItem, proposeEdit, addItemNote]
 * disallowed: [checkItem, uncheckItem, addItem, freeze, editGoal, resolveEdit]
 *
 * Re-exported from workers/worker.ts; this file allows direct imports from
 * workers/integrator as well.
 */
export { integrator } from "./worker";
export type { WorkerFactoryDeps, WorkerRun } from "./worker";
