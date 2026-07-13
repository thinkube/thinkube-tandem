import type { Action, Phase, WorkingModel } from "./model";
import type { WorkerRun } from "./workers/worker";

/**
 * Maps each phase to the worker that handles it.
 * Phases with no registered worker are skipped (step returns []).
 */
export type PhaseWorkerMap = Partial<Record<Phase, WorkerRun>>;

export interface ScratchpadLoopDeps {
  /**
   * Return the worker for the given phase, or undefined if the app has
   * not registered one yet. The loop never assumes a worker exists.
   */
  workerFor?: (phase: Phase) => WorkerRun | undefined;
}

/**
 * The app-owned loop for the Scratchpad.
 *
 * The app drives the pace: call `step` to invoke the current phase's worker
 * and receive the actions it wants dispatched. The app then dispatches them
 * through `reduce` and decides when to call `step` again.
 *
 * No worker may initiate a step on its own; the loop is explicitly driven.
 */
export class ScratchpadLoop {
  private readonly deps: ScratchpadLoopDeps;

  constructor(deps: ScratchpadLoopDeps) {
    this.deps = deps;
  }

  /**
   * Run one step: invoke the worker registered for model.phase and return
   * its actions. Returns [] if no worker is registered for the current phase.
   */
  async step(model: WorkingModel, conversation: string[]): Promise<Action[]> {
    const worker = this.deps.workerFor?.(model.phase);
    if (!worker) {
      return [];
    }
    return worker.run(model, conversation);
  }
}

/** Factory function for the app-owned loop. */
export function createLoop(deps: ScratchpadLoopDeps): ScratchpadLoop {
  return new ScratchpadLoop(deps);
}
