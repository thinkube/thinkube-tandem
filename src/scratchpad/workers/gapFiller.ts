/**
 * Gap-filler worker — pre-gated with GATES.gapFiller.
 * allowed: [proposeItem, addItemNote]
 * disallowed: [checkItem, uncheckItem, addItem, freeze, editGoal, resolveEdit]
 *
 * Re-exported from workers/worker.ts; this file allows direct imports from
 * workers/gapFiller as well.
 */
export { gapFiller } from "./worker";
export type { WorkerFactoryDeps, WorkerRun } from "./worker";
