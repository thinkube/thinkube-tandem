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

/** Minimal structural type of the Claude Agent SDK `query()` we depend on — kept
 *  loose (the same shape auditorRunner uses) so the lazy import doesn't pull SDK
 *  types into the module graph. */
type AgentSdkQuery = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

/**
 * Map the contract's logical MCP tool groups onto Claude Agent SDK `allowedTools`
 * names, so the spawned headless Claude can ACTUALLY invoke the live tools rather
 * than merely read their names in a prompt line (SP-21/3 AC #15 — "production
 * research is live-grounded", not answered from training data).
 *
 *   - "web-fetch"          → the built-in WebFetch + WebSearch tools
 *   - every other group    → an MCP server, allowed at the server level as
 *                            `mcp__<server>` (grants all of that server's tools)
 *
 * The three contract groups therefore resolve to:
 *   tk-package-version → mcp__tk-package-version  (package-version registry checks)
 *   web-fetch          → WebFetch, WebSearch      (fetch pinned-version docs / search)
 *   repo-explorer      → mcp__repo-explorer       (explore pinned source trees)
 */
export function deriveAllowedTools(mcpTools: string[] | undefined): string[] {
  const allowed: string[] = [];
  for (const group of mcpTools ?? []) {
    if (group === "web-fetch") {
      allowed.push("WebFetch", "WebSearch");
    } else {
      allowed.push(`mcp__${group}`);
    }
  }
  return allowed;
}

/**
 * Build the production QueryFn thunk (a () => QueryFn) using the Claude Agent SDK
 * `query()` — the SAME headless-Claude spawn path the orchestrator's auditor /
 * assessor runners use (`@anthropic-ai/claude-agent-sdk`). This is the session's
 * default when deps.loadQuery is absent.
 *
 * The Agent SDK (not the raw Messages API) is what runs a real tool-use loop, so
 * the worker's declared tools are genuinely callable: the round's `mcpTools` groups
 * are mapped to `allowedTools` (see {@link deriveAllowedTools}) and handed to the
 * spawn, giving the model an actual mechanism to hit package registries and fetch
 * pinned-version docs instead of answering from training data. `modelId` is passed
 * as an SDK model alias (e.g. "sonnet"), which the Agent SDK — unlike the raw
 * Messages API — accepts.
 */
export function makeProductionQueryFnThunk(modelId: string): () => QueryFn {
  return (): QueryFn =>
    async function* (args: {
      prompt: string;
      options: QueryOptions;
    }): AsyncIterable<WorkerMessage> {
      // Dynamic import keeps the SDK out of the module graph at extension startup
      // and lets plain node tests inject a fake via loadQuery (no SDK on that path).
      let sdkQuery: AgentSdkQuery;
      try {
        const mod = (await import("@anthropic-ai/claude-agent-sdk")) as {
          query: AgentSdkQuery;
        };
        sdkQuery = mod.query;
      } catch {
        // SDK not available — yield nothing gracefully
        return;
      }

      // Build the system preamble encoding the gate constraints + JSON output
      // shape, folded into the prompt so it travels with the spawn without
      // depending on an SDK system-prompt option.
      const systemParts: string[] = [
        "You are a Tandem Scratchpad worker. Your job is to generate structured actions for the thinking space.",
        `Allowed tools: ${args.options.allowedTools.join(", ") || "(none)"}`,
        `Disallowed tools: ${args.options.disallowedTools.join(", ") || "(none)"}`,
      ];
      if (args.options.mcpTools && args.options.mcpTools.length > 0) {
        systemParts.push(
          `MCP tool groups available (call them — do not answer from memory): ${args.options.mcpTools.join(", ")}`,
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

      // WIRE THE LIVE TOOLS: turn the round's mcpTools groups into allowedTools the
      // spawned agent may actually invoke. Without this the model has no mechanism
      // to reach the registry/docs and would answer from training data (AC #15).
      const allowedTools = deriveAllowedTools(args.options.mcpTools);

      const options: Record<string, unknown> = {
        // Pin the worker's model explicitly so it never inherits the session/env model.
        model: modelId,
        // Research is read-only investigation — bypass interactive permission prompts
        // so the spawned agent can run its tool calls unattended (matches the auditor).
        permissionMode: "bypassPermissions",
        // Thinking OFF for workers (matches the OrchestratorService worker seam): the
        // worker's reasoning lives in its tool calls and the artifacts it is handed.
        thinking: { type: "disabled" },
      };
      if (allowedTools.length > 0) {
        options.allowedTools = allowedTools;
      }

      const fullPrompt = `${systemParts.join("\n")}\n\n${args.prompt}`;

      // Drive the spawn; the Agent SDK runs the tool-use loop internally. Collect the
      // final result text (falling back to concatenated assistant text) and parse the
      // actions JSON out of it.
      let resultText = "";
      let assistantText = "";
      try {
        for await (const msg of sdkQuery({ prompt: fullPrompt, options })) {
          const rec = msg as Record<string, unknown>;
          if (rec.type === "assistant") {
            const m = rec.message as { content?: unknown } | undefined;
            const content = Array.isArray(m?.content) ? m!.content : [];
            for (const b of content as Array<Record<string, unknown>>) {
              if (b.type === "text" && typeof b.text === "string") {
                assistantText += b.text;
              }
            }
          } else if (rec.type === "result" && typeof rec.result === "string") {
            resultText = rec.result;
          }
        }
      } catch {
        // Spawn/run failure — land the round with zero actions rather than crash.
        return;
      }

      const fullText = resultText || assistantText;

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
