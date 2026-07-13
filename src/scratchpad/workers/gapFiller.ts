/**
 * Gap-filler worker — pre-gated with GATES.gapFiller.
 * allowed: [proposeSection, editSection, addNote]
 * disallowed: [freeze, writeArtifact, editGoal]
 *
 * Re-exported from workers/worker.ts; this file allows direct imports from
 * workers/gapFiller as well.
 */
export { gapFiller } from "./worker";
export type { WorkerFactoryDeps, WorkerRun } from "./worker";
