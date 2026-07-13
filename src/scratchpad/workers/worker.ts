import type { Action, ToolName, WorkingModel } from "../model";

// ===== Phase-worker seam =====

export interface WorkerMessage {
  type: "actions";
  actions: Action[];
}

export interface QueryOptions {
  model: string;
  allowedTools: ToolName[];
  disallowedTools: ToolName[];
}

export type QueryFn = (args: {
  prompt: string;
  options: QueryOptions;
}) => AsyncIterable<WorkerMessage>;

export interface PhaseWorkerDeps {
  loadQuery: () => QueryFn;
  model: string;
  allowedTools: ToolName[];
  disallowedTools: ToolName[];
  blindToConversation?: boolean;
}

export interface WorkerFactoryDeps {
  loadQuery: () => QueryFn;
  model: string;
}

export interface WorkerRun {
  /** Returns { model, allowedTools, disallowedTools } from deps. */
  buildOptions(): QueryOptions;
  /**
   * Build the prompt string. Omits `conversation` entirely when
   * blindToConversation is true.
   */
  buildPrompt(model: WorkingModel, conversation: string[]): string;
  /** Flattens every yielded WorkerMessage.actions into a single array. */
  run(model: WorkingModel, conversation: string[]): Promise<Action[]>;
}

// ===== Single source of truth for per-phase gates =====

export const GATES: Record<
  "gapFiller" | "integrator" | "reframe" | "adversarial",
  { allowedTools: ToolName[]; disallowedTools: ToolName[] }
> = {
  gapFiller: {
    allowedTools: ["proposeSection", "editSection", "addNote"],
    disallowedTools: ["freeze", "writeArtifact", "editGoal"],
  },
  integrator: {
    allowedTools: ["editSection", "setSectionState", "addNote"],
    disallowedTools: ["freeze", "writeArtifact"],
  },
  reframe: {
    allowedTools: ["editGoal"],
    disallowedTools: ["freeze", "writeArtifact"],
  },
  adversarial: {
    allowedTools: ["addObjection"],
    disallowedTools: [
      "editGoal",
      "editSection",
      "proposeSection",
      "freeze",
      "writeArtifact",
    ],
  },
};

/**
 * assertWithinGate throws iff:
 *   attempted ∈ disallowedTools
 *   OR (allowedTools non-empty AND attempted ∉ allowedTools)
 */
export function assertWithinGate(
  options: QueryOptions,
  attempted: ToolName,
): void {
  if (options.disallowedTools.includes(attempted)) {
    throw new Error(`Tool '${attempted}' is disallowed in this phase gate`);
  }
  if (
    options.allowedTools.length > 0 &&
    !options.allowedTools.includes(attempted)
  ) {
    throw new Error(
      `Tool '${attempted}' is not in the allowed tools list for this phase gate`,
    );
  }
}

/**
 * Create a phase worker from explicit deps.
 * The returned WorkerRun:
 *   - buildOptions() → { model, allowedTools, disallowedTools }
 *   - buildPrompt(model, conversation) → omits conversation when blindToConversation
 *   - run(model, conversation) → flattens all yielded WorkerMessage.actions
 */
export function createPhaseWorker(deps: PhaseWorkerDeps): WorkerRun {
  return {
    buildOptions(): QueryOptions {
      return {
        model: deps.model,
        allowedTools: deps.allowedTools,
        disallowedTools: deps.disallowedTools,
      };
    },

    buildPrompt(workingModel: WorkingModel, conversation: string[]): string {
      const modelJson = JSON.stringify(workingModel, null, 2);
      if (deps.blindToConversation) {
        return `Analyze the working model and generate actions.\n\nWorking Model:\n${modelJson}`;
      }
      const convText = conversation.join("\n");
      return (
        `Analyze the working model and conversation, then generate actions.\n\n` +
        `Working Model:\n${modelJson}\n\nConversation:\n${convText}`
      );
    },

    async run(
      workingModel: WorkingModel,
      conversation: string[],
    ): Promise<Action[]> {
      const options = this.buildOptions();
      const prompt = this.buildPrompt(workingModel, conversation);
      const query = deps.loadQuery();
      const actions: Action[] = [];
      for await (const msg of query({ prompt, options })) {
        if (msg.type === "actions") {
          actions.push(...msg.actions);
        }
      }
      return actions;
    },
  };
}

/**
 * Gap-filler worker — pre-gated with GATES.gapFiller.
 * allowed: [proposeSection, editSection, addNote]
 * disallowed: [freeze, writeArtifact, editGoal]
 */
export function gapFiller(deps: WorkerFactoryDeps): WorkerRun {
  return createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.gapFiller.allowedTools,
    disallowedTools: GATES.gapFiller.disallowedTools,
  });
}

/**
 * Integrator worker — pre-gated with GATES.integrator.
 * allowed: [editSection, setSectionState, addNote]
 * disallowed: [freeze, writeArtifact]
 */
export function integrator(deps: WorkerFactoryDeps): WorkerRun {
  return createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.integrator.allowedTools,
    disallowedTools: GATES.integrator.disallowedTools,
  });
}
