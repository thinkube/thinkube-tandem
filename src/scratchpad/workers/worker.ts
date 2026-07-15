import type { Action, ToolName, WorkingModel } from "../model";

// Re-export ToolName from the worker seam: QueryOptions/QueryFn/GATES here are all
// expressed in terms of it, so a consumer importing the gating API from this module
// expects the ToolName type alongside them.
export type { ToolName } from "../model";

// ===== Phase-worker seam =====

export interface WorkerMessage {
  type: "actions";
  actions: Action[];
}

/**
 * Query options extended with optional MCP tool groups and corpus paths
 * so that the wiring is observable to an injected fake (SP-21/3 contract).
 */
export interface QueryOptions {
  model: string;
  allowedTools: ToolName[];
  disallowedTools: ToolName[];
  /** External MCP tool groups this worker may reach. */
  mcpTools?: string[];
  /** Directories whose content grounds the round (corpus scope). */
  corpusPaths?: string[];
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
  /** MCP tool groups passed into QueryOptions for this worker. */
  mcpTools?: string[];
  /** Corpus paths passed into QueryOptions for this worker. */
  corpusPaths?: string[];
}

export interface WorkerFactoryDeps {
  loadQuery: () => QueryFn;
  model: string;
}

export interface WorkerRun {
  /** Returns { model, allowedTools, disallowedTools, mcpTools?, corpusPaths? } from deps. */
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
// Restated over the new item action vocabulary (SP-21/3 contract).

export const GATES: Record<
  | "gapFiller"
  | "integrator"
  | "reframe"
  | "adversarial"
  | "research"
  | "interpreter",
  { allowedTools: ToolName[]; disallowedTools: ToolName[] }
> = {
  /**
   * Gap-filler: may propose items and add notes.
   * Must NOT check/uncheck, add (human-born) items, freeze, edit goal, or resolve edits.
   */
  gapFiller: {
    allowedTools: ["proposeItem", "addItemNote"],
    disallowedTools: [
      "checkItem",
      "uncheckItem",
      "addItem",
      "freeze",
      "editGoal",
      "resolveEdit",
    ],
  },
  /**
   * Integrator: may propose items, propose edits, add notes.
   * Must NOT check/uncheck, add (human-born) items, freeze, edit goal, or resolve edits.
   */
  integrator: {
    allowedTools: ["proposeItem", "proposeEdit", "addItemNote"],
    disallowedTools: [
      "checkItem",
      "uncheckItem",
      "addItem",
      "freeze",
      "editGoal",
      "resolveEdit",
    ],
  },
  /**
   * Reframe: may edit the goal only.
   * Everything else is disallowed.
   */
  reframe: {
    allowedTools: ["editGoal"],
    disallowedTools: [
      "proposeItem",
      "addItemNote",
      "proposeEdit",
      "checkItem",
      "uncheckItem",
      "addItem",
      "freeze",
      "resolveEdit",
      "editSection",
      "proposeSection",
      "addNote",
      "addObjection",
      "setSectionState",
      "writeArtifact",
      "editItemText",
      "setModality",
      "setEval",
      "deferItem",
      "dropItem",
      "supersedeItem",
      "attachEvidence",
      "stampShipped",
    ],
  },
  /**
   * Adversarial: may add objections only.
   * Cannot edit goal, sections, freeze.
   */
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
  /**
   * Research: may propose items, attach evidence, add notes.
   * May NOT check/uncheck, freeze, edit goal, resolve edits, or propose edits.
   */
  research: {
    allowedTools: ["proposeItem", "attachEvidence", "addItemNote"],
    disallowedTools: [
      "checkItem",
      "uncheckItem",
      "addItem",
      "freeze",
      "editGoal",
      "resolveEdit",
      "proposeEdit",
    ],
  },
  /**
   * Interpreter (command-field): the human UI action vocabulary.
   * Freeze is absent — the interpreter gate NEVER contains freeze.
   */
  interpreter: {
    allowedTools: [
      "addItem",
      "checkItem",
      "uncheckItem",
      "editItemText",
      "setModality",
      "setEval",
      "deferItem",
      "dropItem",
      "supersedeItem",
      "resolveEdit",
      "addItemNote",
    ],
    disallowedTools: ["freeze"],
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
 *   - buildOptions() → { model, allowedTools, disallowedTools, mcpTools?, corpusPaths? }
 *   - buildPrompt(model, conversation) → omits conversation when blindToConversation
 *   - run(model, conversation) → flattens all yielded WorkerMessage.actions
 */
export function createPhaseWorker(deps: PhaseWorkerDeps): WorkerRun {
  return {
    buildOptions(): QueryOptions {
      const opts: QueryOptions = {
        model: deps.model,
        allowedTools: deps.allowedTools,
        disallowedTools: deps.disallowedTools,
      };
      if (deps.mcpTools !== undefined) {
        opts.mcpTools = deps.mcpTools;
      }
      if (deps.corpusPaths !== undefined) {
        opts.corpusPaths = deps.corpusPaths;
      }
      return opts;
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
 * Build the production QueryFn thunk (a () => QueryFn) using the Anthropic
 * SDK — the same integration pattern the orchestrator's assessor/judge runners
 * use. This is the session's default when deps.loadQuery is absent.
 *
 * The thunk constructs a new SDK client on every call so each worker round gets
 * a fresh request (matches the assessor/judge runner pattern).
 */
export function makeProductionQueryFnThunk(modelId: string): () => QueryFn {
  return (): QueryFn =>
    async function* (args: {
      prompt: string;
      options: QueryOptions;
    }): AsyncIterable<WorkerMessage> {
      // Dynamic import avoids loading the SDK at extension startup and keeps
      // the module importable in plain node tests where the fake is injected
      // via loadQuery (no SDK needed in that path).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let AnthropicCtor: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require("@anthropic-ai/sdk") as { default?: unknown };
        AnthropicCtor = mod.default ?? mod;
      } catch {
        // SDK not available — yield nothing gracefully
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client: any = new AnthropicCtor();

      // Build system prompt encoding the gate constraints
      const systemParts: string[] = [
        "You are a Tandem Scratchpad worker. Your job is to generate structured actions for the thinking space.",
        `Allowed tools: ${args.options.allowedTools.join(", ") || "(none)"}`,
        `Disallowed tools: ${args.options.disallowedTools.join(", ") || "(none)"}`,
      ];
      if (args.options.mcpTools && args.options.mcpTools.length > 0) {
        systemParts.push(
          `MCP tool groups available: ${args.options.mcpTools.join(", ")}`,
        );
      }
      if (args.options.corpusPaths && args.options.corpusPaths.length > 0) {
        systemParts.push(
          `Corpus paths (ground your responses in files here): ${args.options.corpusPaths.join(", ")}`,
        );
      }
      systemParts.push(
        'Respond with a JSON object: { "actions": [ ...action objects... ] }',
        "Each action must conform to the Action type and use only allowed tools.",
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream: any = client.messages.stream({
        model: modelId,
        max_tokens: 4096,
        system: systemParts.join("\n"),
        messages: [{ role: "user", content: args.prompt }],
      });

      // Collect streamed text then parse
      let fullText = "";
      for await (const chunk of stream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta?.type === "text_delta" &&
          chunk.delta.text
        ) {
          fullText += chunk.delta.text as string;
        }
      }

      // Extract JSON actions from the response
      try {
        const jsonMatch = fullText.match(/\{[\s\S]*"actions"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { actions: Action[] };
          if (Array.isArray(parsed.actions)) {
            yield { type: "actions", actions: parsed.actions };
          }
        }
      } catch {
        // Parse failure — yield nothing; round lands with zero actions
      }
    };
}

/**
 * Gap-filler worker — pre-gated with GATES.gapFiller.
 * allowed: [proposeItem, addItemNote]
 * disallowed: [checkItem, uncheckItem, addItem, freeze, editGoal, resolveEdit]
 *
 * Prompt content rule (SP-21/3 contract): prefill's prompt contains the intent
 * text, every existing item (including shipped ones), and each item's evidence
 * dossierRefs — the space's accumulated context travels with every prefill round.
 */
export function gapFiller(deps: WorkerFactoryDeps): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.gapFiller.allowedTools,
    disallowedTools: GATES.gapFiller.disallowedTools,
  });

  return {
    ...base,
    buildPrompt(workingModel: WorkingModel, _conversation: string[]): string {
      const goalSection = workingModel.sections.find((s) => s.kind === "goal");
      const intentText = goalSection?.text ?? "";

      const itemLines: string[] = [];
      for (const section of workingModel.sections) {
        if (section.kind === "goal") continue;
        for (const item of section.items) {
          const dossierRefs = item.evidence
            .filter((ev) => ev.dossierRef !== undefined)
            .map((ev) => ev.dossierRef as string);
          const refsStr =
            dossierRefs.length > 0
              ? ` [dossier: ${dossierRefs.join(", ")}]`
              : "";
          const shippedMark = item.state === "shipped" ? " (shipped)" : "";
          itemLines.push(
            `  [${section.kind}]${shippedMark} ${item.text}${refsStr}`,
          );
        }
      }

      const itemsBlock =
        itemLines.length > 0
          ? `\n\nExisting items (all states, including shipped):\n${itemLines.join("\n")}`
          : "\n\nNo items yet.";

      return (
        `You are the gap-filler worker. Propose new items (proposeItem) for each thinking-space section to help elaborate the intent.\n\n` +
        `Intent (goal):\n${intentText}` +
        itemsBlock +
        `\n\nGenerate proposeItem actions for sections that need more detail. Do not check items — only propose them (checked:false, state:active).`
      );
    },
  };
}

/**
 * Integrator worker — pre-gated with GATES.integrator.
 * allowed: [proposeItem, proposeEdit, addItemNote]
 * disallowed: [checkItem, uncheckItem, addItem, freeze, editGoal, resolveEdit]
 *
 * Runs automatically after a debounced human batch from the session.
 */
export function integrator(deps: WorkerFactoryDeps): WorkerRun {
  return createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.integrator.allowedTools,
    disallowedTools: GATES.integrator.disallowedTools,
  });
}
