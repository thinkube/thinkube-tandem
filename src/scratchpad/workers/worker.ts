import type { Action, ToolName, WorkingModel } from "../model";
import {
  normalizeWorkerActions,
  renderActionGuide,
  type WorkerActor,
} from "./actionGuide";

// Re-export ToolName from the worker seam: QueryOptions/QueryFn/GATES here are all
// expressed in terms of it, so a consumer importing the gating API from this module
// expects the ToolName type alongside them.
export type { ToolName } from "../model";

// ===== Phase-worker seam =====

export interface WorkerMessage {
  type: "actions";
  actions: Action[];
  /**
   * Item ids the round STAGES for a human-applied action (the command-field
   * "selection for action"). Distinct from checking: checked items are settled
   * into the TEP; selected items are an ephemeral staging area. Only the
   * interpreter round uses this channel.
   */
  select?: string[];
  /** Utterance classification (interpreter rounds only, 2026-07-17):
   *  operation | statement | ask | question. */
  classify?: string;
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
  /**
   * The worker actor stamped on normalized actions and shown in the action
   * guide's worked examples. Defaults to "integrator" for gates whose tools
   * carry no actor (e.g. reframe's editGoal).
   */
  actor?: WorkerActor;
}

export interface WorkerFactoryDeps {
  loadQuery: () => QueryFn;
  model: string;
  /** The context digest's markdown (read by the session from
   *  contextDigestRef) — the sanctioned context channel (2026-07-17). */
  contextDigest?: string;
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

/**
 * Grounding blocks shared by every generative round (2026-07-17): the human's
 * standing assumptions (from the model) and the context digest (the sanctioned
 * context channel). Both clearly labeled so provenance stays traceable.
 */
export function renderGroundingBlocks(
  workingModel: WorkingModel,
  contextDigest?: string,
): string {
  let out = "";
  const assumptions = workingModel.assumptions ?? [];
  if (assumptions.length > 0) {
    out +=
      `\n\nSTANDING ASSUMPTIONS (human statements — nothing you produce may contradict them):\n` +
      assumptions.map((a, i) => `${i + 1}. ${a.text}`).join("\n");
  }
  if (contextDigest?.trim()) {
    out +=
      `\n\nCONTEXT DIGEST (research/_context-digest.md — what already EXISTS; cite it, build on it, never silently contradict it):\n` +
      contextDigest.trim();
  }
  return out;
}

// ===== Single source of truth for per-phase gates =====
// Restated over the new item action vocabulary (SP-21/3 contract).

export const GATES: Record<
  | "gapFiller"
  | "integrator"
  | "reframe"
  | "adversarial"
  | "research"
  | "interpreter"
  | "explainer"
  | "linker"
  | "challenger",
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
    allowedTools: ["curateIntent"],
    disallowedTools: [
      "editGoal",
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
   * Explainer: annotates ONE item with a Why/Impact note so the human can
   * take an informed settle/defer/drop decision. Notes only — it can neither
   * propose, check, nor edit anything.
   */
  explainer: {
    allowedTools: ["addItemNote"],
    disallowedTools: [
      "proposeItem",
      "proposeEdit",
      "checkItem",
      "uncheckItem",
      "addItem",
      "freeze",
      "editGoal",
      "resolveEdit",
      "attachEvidence",
    ],
  },
  /**
   * Linker: proposes dependency edges (requires) between EXISTING items —
   * pre-edge spaces have none, so cuts pulled zero context. Edges only; it
   * can neither propose, note, check, nor edit anything.
   */
  linker: {
    allowedTools: ["linkItems"],
    disallowedTools: [
      "proposeItem",
      "proposeEdit",
      "addItemNote",
      "attachEvidence",
      "checkItem",
      "uncheckItem",
      "addItem",
      "freeze",
      "editGoal",
      "curateIntent",
      "resolveEdit",
    ],
  },
  /**
   * Challenger: applies a NEW standing assumption against existing items —
   * stages contradicting items (select channel), proposes reconciling edits,
   * and notes which assumption an item conflicts with. Never applies anything
   * destructive itself.
   */
  challenger: {
    allowedTools: ["proposeEdit", "addItemNote"],
    disallowedTools: [
      "proposeItem",
      "checkItem",
      "uncheckItem",
      "addItem",
      "freeze",
      "editGoal",
      "curateIntent",
      "resolveEdit",
      "attachEvidence",
      "linkItems",
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
      "resolveItem",
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
      const guide = renderActionGuide(
        workingModel,
        deps.allowedTools,
        deps.actor ?? "integrator",
      );
      if (deps.blindToConversation) {
        return `Analyze the working model and generate actions.\n\nWorking Model:\n${modelJson}\n\n${guide}`;
      }
      const convText = conversation.join("\n");
      return (
        `Analyze the working model and conversation, then generate actions.\n\n` +
        `Working Model:\n${modelJson}\n\nConversation:\n${convText}\n\n${guide}`
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
      // Validation seam: coerce/verify every parsed action against the live
      // model and this worker's gate BEFORE anything reaches the reducer. A
      // malformed action becomes a readable rejection, never a mid-round throw.
      const { valid, rejected } = normalizeWorkerActions(
        actions as unknown[],
        workingModel,
        {
          defaultActor: deps.actor ?? "integrator",
          allowedTools: deps.allowedTools,
        },
      );
      if (rejected.length > 0) {
        console.error(
          `[phaseWorker] rejected ${rejected.length} malformed/out-of-gate action(s): ` +
            rejected.map((r) => r.reason).join("; "),
        );
      }
      if (valid.length === 0 && rejected.length > 0) {
        // Every action the round produced was unusable — surface that honestly
        // as a failed round rather than landing a silent no-op (false green).
        throw new Error(
          `The worker produced ${rejected.length} action(s), all malformed — first: ${rejected[0].reason}`,
        );
      }
      return valid;
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
export function makeProductionQueryFnThunk(
  modelId: string,
  log?: (line: string) => void,
): () => QueryFn {
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
        "The thinking space is domain- and technology-agnostic: propose at intent altitude — what must hold, be decided, or be verified — never implementation detail (languages, frameworks, libraries, endpoints, CI systems), and do not assume the project is a software project, unless the intent text itself names those specifics.",
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
        'Respond with EXACTLY ONE JSON object: { "actions": [ ...action objects... ] }',
        'The task prompt below contains the exact JSON shape for every action you may emit, plus the live sectionId/itemId values — copy those shapes exactly (the key is "type", never "tool"). Malformed actions and invented IDs are rejected.',
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
        // Corpus grounding requires the read tools — an allowlist without them
        // made "ground your responses in files here" unactionable.
        options.allowedTools =
          args.options.corpusPaths && args.options.corpusPaths.length > 0
            ? [...allowedTools, "Read", "Grep", "Glob"]
            : allowedTools;
        // Live-tooled rounds (research) may read but never mutate.
        options.disallowedTools = ["Write", "Edit", "NotebookEdit"];
      } else {
        // Blind generation rounds (prefill/integrator/reframe/interpreter):
        // the verdict comes from the prompt ALONE. Without this, the spawned
        // agent could read the host workspace and flavor its proposals with
        // whatever project it happens to be sitting in (field defect
        // 2026-07-16: prefill items presumed this extension's tech stack).
        options.disallowedTools = [
          "Read",
          "Grep",
          "Glob",
          "Bash",
          "WebFetch",
          "WebSearch",
          "Write",
          "Edit",
          "NotebookEdit",
          "Task",
        ];
      }

      const fullPrompt = `${systemParts.join("\n")}\n\n${args.prompt}`;

      // Drive the spawn; the Agent SDK runs the tool-use loop internally. Collect the
      // final result text (falling back to concatenated assistant text) and parse the
      // actions JSON out of it.
      let resultText = "";
      let assistantText = "";
      log?.(
        `▸ worker spawn (model: ${modelId}; tools: ${
          (options.allowedTools as string[] | undefined)?.join(", ") ?? "none (blind)"
        })`,
      );
      try {
        for await (const msg of sdkQuery({ prompt: fullPrompt, options })) {
          const rec = msg as Record<string, unknown>;
          if (rec.type === "assistant") {
            const m = rec.message as { content?: unknown } | undefined;
            const content = Array.isArray(m?.content) ? m!.content : [];
            for (const b of content as Array<Record<string, unknown>>) {
              if (b.type === "text" && typeof b.text === "string") {
                assistantText += b.text;
                for (const line of b.text.split("\n")) {
                  if (line.trim()) log?.(`  │ ${line}`);
                }
              } else if (b.type === "tool_use") {
                log?.(`  ⚒ tool: ${String((b as { name?: unknown }).name ?? "?")}`);
              }
            }
          } else if (rec.type === "result" && typeof rec.result === "string") {
            resultText = rec.result;
          }
        }
      } catch (err) {
        // Spawn/run failure — land the round with zero actions rather than crash.
        log?.(
          `  ✗ worker stream failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      const fullText = resultText || assistantText;

      // Extract JSON actions from the response
      try {
        const jsonMatch = fullText.match(/\{[\s\S]*"actions"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            actions: Action[];
            select?: unknown;
            classify?: unknown;
          };
          if (Array.isArray(parsed.actions)) {
            const msg: WorkerMessage = {
              type: "actions",
              actions: parsed.actions,
            };
            // Selection-for-action passthrough (interpreter rounds only —
            // other rounds simply never emit it).
            if (Array.isArray(parsed.select)) {
              msg.select = parsed.select.filter(
                (id): id is string => typeof id === "string",
              );
            }
            if (typeof parsed.classify === "string") {
              msg.classify = parsed.classify;
            }
            yield msg;
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
    actor: "gap-filler",
  });

  return {
    ...base,
    buildPrompt(workingModel: WorkingModel, _conversation: string[]): string {
      const goalSection = workingModel.sections.find((s) => s.kind === "goal");
      const intentText = goalSection?.text ?? "";
      const requests = workingModel.roughRequests ?? [];
      // The journal INCLUDES the goal as entry 1 (the goal is the first rough
      // entry by doctrine). 2026-07-18 field defect: the old "NEWEST entry
      // only" doctrine assumed every entry had already triggered its own
      // round — false since the guided flow decomposes ONCE at the human's
      // word, which silently skipped the goal and all but the last entry
      // (a 4-entry space expanded to 5 items, all from entry 4, 0 elements).
      const journalEntries = [
        ...(intentText.trim() ? [intentText.trim()] : []),
        ...requests.map((r) => r.text),
      ];
      const requestsBlock =
        journalEntries.length > 0
          ? `\n\nJournal (the human's raw asks, numbered — entry 1 is the goal):\n${journalEntries
              .map((t, i) => `${i + 1}. ${t}`)
              .join("\n")}`
          : "";
      const deltaDoctrine =
        `\n\nEXPANSION DOCTRINE (absorb the WHOLE journal into the space):\n` +
        `- COVERAGE: propose the items needed so that EVERY numbered journal entry's substance is represented ` +
        `by items in the space. On an empty space that means decomposing ALL entries, the goal included. ` +
        `When items already exist, propose only the missing delta — and say nothing for entries already covered.\n` +
        `- ELEMENTS FIRST: elements are the SUBJECT MATTER — the concrete things the journal commits to building. ` +
        `Derive constraints, gaps, criteria and verification FROM the elements, never free-floating. ` +
        `An expansion that leaves the elements section empty while the journal names buildable things is WRONG.\n` +
        `- SUFFICIENCY per entry: a handful of sharp items per entry beats a wall of plausible ones ` +
        `(roughly 3-6 per entry across all sections, fewer when entries overlap).\n` +
        `- NEVER restate or near-duplicate ANY listed item IN ANY WORDING — including dropped (human veto) and resolved (answered) ones. ` +
        `If you believe a vetoed/answered concept must return, say so in an addItemNote on a related item instead of re-proposing it.\n` +
        `- Proposing zero items is a legitimate outcome ONLY when every journal entry is already covered by existing items.`;

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
          const stateMark =
            item.state === "active"
              ? ""
              : ` (${item.state}${
                  item.state === "dropped"
                    ? " — VETOED by the human, never re-propose in any wording"
                    : item.state === "resolved"
                      ? " — question ANSWERED, never re-ask in any wording"
                      : ""
                })`;
          itemLines.push(
            `  [${section.kind}]${stateMark} ${item.text}${refsStr}`,
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
        requestsBlock +
        renderGroundingBlocks(workingModel, deps.contextDigest) +
        deltaDoctrine +
        itemsBlock +
        `\n\nGenerate proposeItem actions for sections that need more detail. Do not check items — only propose them. ` +
        `Stay at intent altitude: propose what must hold, be decided, or be verified — not implementation choices ` +
        `(languages, frameworks, endpoints, tooling) — and assume nothing about the project's domain beyond the intent text itself. ` +
        `EVERY proposed item must carry its "note" (Why / Impact / Modality, one sentence each) — the human takes the ` +
        `settle/defer/drop decision on that note, so a bare one-liner is an incomplete proposal.\n\n` +
        renderActionGuide(
          workingModel,
          GATES.gapFiller.allowedTools,
          "gap-filler",
        )
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
    actor: "integrator",
  });
}

/**
 * Linker worker — pre-gated with GATES.linker (linkItems only).
 *
 * ONE blind round proposes dependency edges between EXISTING items: an edge
 * only where one item's meaning genuinely depends on another (a constraint
 * governing an element, a criterion judging it, a gap questioning it).
 * Conservative by doctrine: a wrong edge pollutes every future cut.
 */
export function linker(deps: WorkerFactoryDeps): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.linker.allowedTools,
    disallowedTools: GATES.linker.disallowedTools,
    actor: "integrator",
  });

  return {
    ...base,
    buildPrompt(workingModel: WorkingModel, _conversation: string[]): string {
      const goalSec = workingModel.sections.find((s) => s.kind === "goal");
      const intentText = goalSec?.text ?? "";
      const itemLines: string[] = [];
      for (const section of workingModel.sections) {
        if (section.kind === "goal") continue;
        for (const item of section.items) {
          if (item.state === "dropped") continue;
          const existing =
            (item.requires?.length ?? 0) > 0
              ? ` (already requires: ${item.requires!.join(", ")})`
              : "";
          const why = item.notes.find((n) => /^\s*Why\s*:/i.test(n.text));
          itemLines.push(
            `- [${section.kind}] itemId "${item.id}": "${item.text}"${existing}${
              why ? `\n    ${why.text.split("\n")[0]}` : ""
            }`,
          );
        }
      }

      return (
        `You are the linker worker. Propose dependency edges (linkItems) between the EXISTING items below. ` +
        `An edge means one item's MEANING depends on another: a constraint that governs an element, a criterion ` +
        `that judges one, a gap that questions one, a verification that checks one. Edges let a TEP cut pull the ` +
        `right context automatically — a WRONG edge pollutes every future cut, so be conservative: no edge is ` +
        `better than a doubtful edge. Do not link items that are merely thematically similar.\n\n` +
        `Intent (goal):\n${intentText}` +
        renderGroundingBlocks(workingModel, deps.contextDigest) +
        `\n\nItems:\n${itemLines.join("\n")}\n\n` +
        renderActionGuide(workingModel, GATES.linker.allowedTools, "integrator")
      );
    },
  };
}

/**
 * Explainer worker — pre-gated with GATES.explainer.
 * allowed: [addItemNote] only.
 *
 * Annotates the target items with a compact Why/Impact/Modality note so the
 * human can take an informed settle/defer/drop decision (field request
 * 2026-07-16: a bare one-line item gives nothing to decide on). ONE round
 * covers all targets — never a round per item. Blind round: the explanation
 * is derived from the intent and the space's own content, nothing else.
 */
export function explainer(
  deps: WorkerFactoryDeps,
  itemIds: string[],
): WorkerRun {
  const base = createPhaseWorker({
    loadQuery: deps.loadQuery,
    model: deps.model,
    allowedTools: GATES.explainer.allowedTools,
    disallowedTools: GATES.explainer.disallowedTools,
    actor: "integrator",
  });
  const targets = new Set(itemIds);

  return {
    ...base,
    buildPrompt(workingModel: WorkingModel, _conversation: string[]): string {
      const goalSec = workingModel.sections.find((s) => s.kind === "goal");
      const intentText = goalSec?.text ?? "";

      const targetLines: string[] = [];
      const contextLines: string[] = [];
      for (const section of workingModel.sections) {
        for (const item of section.items) {
          if (item.state === "dropped") continue;
          const line = `- [${section.kind}] (${item.modality}) "${item.text}" — itemId "${item.id}"`;
          if (targets.has(item.id)) {
            targetLines.push(line);
          } else {
            contextLines.push(`- [${section.kind}] ${item.text}`);
          }
        }
      }

      return (
        `You are the item-explainer worker. Produce EXACTLY ONE addItemNote action PER TARGET ITEM below — ` +
        `every target gets exactly one note; skipping a target or noting one twice is a failed round. ` +
        `The notes give the human what they need to decide whether to settle (check), defer, or drop each item.\n\n` +
        `Each note's text must have exactly this shape:\n` +
        `Why: <1-2 sentences — the role this item plays in the intent; what question or risk it settles>\n` +
        `Impact: <1-2 sentences — what including it commits the work to, and what is lost or risked if it is dropped>\n` +
        `Modality: <1-2 sentences — is the item's current classification right for this intent ` +
        `(mandatory = the intent cannot be delivered without it; optional = the intent survives without it), ` +
        `and what concretely happens if the item is left unsettled>\n\n` +
        `Stay at intent altitude and domain-agnostic: no implementation detail (languages, frameworks, tooling) ` +
        `unless the intent itself names it. Ground every claim in the intent and the space's content — never invent context.\n\n` +
        `Intent (goal):\n${intentText}\n\n` +
        `TARGET items (one addItemNote each — use the exact itemId):\n${targetLines.join("\n")}\n\n` +
        (contextLines.length > 0
          ? `Other items in the space (context only — do NOT annotate these):\n${contextLines.join("\n")}\n\n`
          : "") +
        renderActionGuide(
          workingModel,
          GATES.explainer.allowedTools,
          "integrator",
        ) +
        `\n\nYou may ONLY target these itemIds: ${[...targets].map((id) => `"${id}"`).join(", ")}.`
      );
    },

    async run(
      workingModel: WorkingModel,
      conversation: string[],
    ): Promise<Action[]> {
      const actions = await base.run.call(this, workingModel, conversation);
      // Belt over the prompt pin: drop notes aimed outside the target set,
      // and DEDUPE to one note per target (first wins) — a worker emitting
      // two divergent explanations for one item was a field defect
      // (2026-07-16: duplicated, contradictory whys).
      const seen = new Set<string>();
      const result: Action[] = [];
      for (const a of actions) {
        if (a.type !== "addItemNote") {
          result.push(a);
          continue;
        }
        const itemId = (a as { itemId: string }).itemId;
        if (!targets.has(itemId) || seen.has(itemId)) continue;
        seen.add(itemId);
        result.push(a);
      }
      return result;
    },
  };
}
