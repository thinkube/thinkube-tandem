import * as vscode from "vscode";
import { emptyModel, reduce } from "./model";
import { ScratchpadDocumentView } from "./views/document";

// ===== Public re-exports =====

export { emptyModel, goalSection, reduce, freezeEnabled } from "./model";
export type {
  Tenant,
  Phase,
  SectionKind,
  SectionState,
  Coverage,
  ToolName,
  Note,
  Proposal,
  Objection,
  Section,
  ReadinessRecord,
  WorkingModel,
  Action,
  Delta,
} from "./model";

export { serialize, deserialize } from "./persistence";

export {
  createPhaseWorker,
  gapFiller,
  integrator,
  GATES,
  assertWithinGate,
} from "./workers/worker";
export type {
  WorkerMessage,
  QueryFn,
  QueryOptions,
  PhaseWorkerDeps,
  WorkerFactoryDeps,
  WorkerRun,
} from "./workers/worker";

export { createLoop, ScratchpadLoop } from "./loop";
export type { PhaseWorkerMap, ScratchpadLoopDeps } from "./loop";

export { ScratchpadDocumentView, STATE_MARKERS } from "./views/document";

// ===== Command registration =====

let _view: ScratchpadDocumentView | undefined;

/**
 * Register the Scratchpad commands with VS Code.
 * Call this from extension.ts activate().
 */
export function registerScratchpadCommands(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.scratchpad.open", () => {
      if (!_view) {
        _view = new ScratchpadDocumentView();
        context.subscriptions.push(_view);
      }
      const model = emptyModel("tep");
      _view.show(context.extensionUri, model, (action) => {
        // Dispatch actions through the reducer — in a real session the model
        // would be held in state and updated here.
        void reduce(model, action);
      });
    }),
  );
}
