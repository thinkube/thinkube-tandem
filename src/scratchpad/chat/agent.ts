/**
 * The Thinky AGENT (2026-07-17) — the chat's brain, replacing the
 * interpreter-behind-a-pipe architecture the field test exposed ("whatever I
 * ask I get a similar response").
 *
 * Design (approved):
 *  - One persistent Agent SDK conversation per thinking space (resume id kept
 *    in-memory; the space snapshot re-grounds every turn, so a lost resume
 *    only loses conversational nuance, never facts).
 *  - The agent's tool belt IS the tandem verb set, each tool calling the SAME
 *    postFromWebview seam every other surface uses — same gates, same
 *    normalize layer, same provenance.
 *  - HUMAN SOVEREIGNTY: settling (check), destructive verbs, freeze and panic
 *    are NOT in the belt. The agent stages and prepares; the human acts via
 *    the state-derived buttons.
 *  - Model: pinned to sonnet (the chat routes and narrates; design/audit
 *    cognition lives in the worker rounds with their own role-based models).
 *
 * Pure parts (snapshot renderer, system prompt, tool executors) are
 * vscode-free and tested; the SDK glue is a thin production thunk.
 */

import type { Delta, WorkingModel } from "../model";
import type { ScratchpadInboundMessage } from "../session";
import { computeElementRisk } from "../deriveRisk";

/** The narrow session surface the agent's tools need. */
export interface ThinkyAgentSessionLike {
  readonly model: WorkingModel;
  readonly lastCommandMessage: string | undefined;
  readonly selectionCount?: number;
  readonly selectedItemIds?: readonly string[];
  readonly contextSources?: readonly string[];
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
  dispatch?(action: unknown): Delta;
}

// ── Grounding ────────────────────────────────────────────────────────────────

/** Live space snapshot injected every turn — ids, settled marks, states, evals. */
export function renderSpaceSnapshot(session: ThinkyAgentSessionLike): string {
  const model = session.model;
  const goal =
    model.sections.find((s) => s.kind === "goal")?.text.trim() ?? "";
  const lines: string[] = ["[SPACE STATE]"];
  const journal = [goal, ...(model.roughRequests ?? []).map((r) => r.text)];
  lines.push("Journal:");
  journal.forEach((t, i) => lines.push(`  ${i + 1}. ${t.slice(0, 200)}`));
  const assumptions = model.assumptions ?? [];
  if (assumptions.length > 0) {
    lines.push("Standing assumptions:");
    assumptions.forEach((a, i) =>
      lines.push(`  A${i + 1}. ${a.text.slice(0, 200)}`),
    );
  }
  for (const sec of model.sections) {
    if (sec.kind === "goal") continue;
    const items = sec.items.filter((it) => it.state !== "dropped");
    if (items.length === 0) continue;
    lines.push(`${sec.kind}:`);
    for (const it of items) {
      const marks: string[] = [];
      if (it.checked && it.state === "active") marks.push("✓settled");
      if (it.state !== "active") marks.push(it.state);
      if (it.evals.complexity !== undefined) marks.push(`C${it.evals.complexity}`);
      if (sec.kind === "elements" && it.state === "active")
        marks.push(`R${computeElementRisk(model, it.id).score}`);
      if (it.servesEntry !== undefined) marks.push(`entry${it.servesEntry}`);
      if ((it.flaggedBy ?? []).length > 0) marks.push("protected");
      lines.push(
        `  - ${it.id}${marks.length ? ` [${marks.join(",")}]` : ""} ${it.text.slice(0, 160)}`,
      );
    }
  }
  if (model.curatedTitle) lines.push(`Curated intent: ${model.curatedTitle}`);
  if (session.contextSources?.length) {
    lines.push(
      `Declared context sources (contextualize reads EXACTLY these — not chooseable): ${session.contextSources.join(", ")}`,
    );
  }
  if ((session.selectionCount ?? 0) > 0) {
    lines.push(
      `Staged for human action: ${session.selectionCount} item(s)${
        session.selectedItemIds?.length
          ? ` [${session.selectedItemIds.join(", ")}]`
          : ""
      }`,
    );
  }
  const out = lines.join("\n");
  return out.length <= 12000
    ? out
    : `${out.slice(0, 12000)}\n[snapshot clipped]`;
}

export function buildThinkySystemPrompt(): string {
  return (
    `You are Thinky, the Thinkube tandem thinking-space assistant. You converse with the human ` +
    `about their design intent and act on the space ONLY through your tools.\n\n` +
    `Doctrine (non-negotiable):\n` +
    `- HUMAN SOVEREIGNTY: you cannot settle (check), drop, defer, freeze, or panic. Those acts belong ` +
    `to the human. You STAGE items (stage_items) and the human applies the verb via the buttons.\n` +
    `- When refusing a sovereign act, point at the REAL control and never invent UI: settling = the ` +
    `checkbox on the board; staged verbs = the board's action bar; panic (wipe derived state, keep the ` +
    `journal) = the /panic slash command here or the Panic button in the board's top bar; freeze = the ` +
    `board's Freeze button once the gate is green; deleting a mis-captured journal entry = the ✕ next to it ` +
    `in the board's Journal fold.\n` +
    `- Cuts carve a TEP from SETTLED elements. cut_elements accepts element item ids; the closure ` +
    `pulls related context automatically at readiness/preview time.\n` +
    `- Never invent item ids — use exactly the ids in [SPACE STATE]. If the human refers to items ` +
    `("the checked elements", "the auth one"), resolve them from the snapshot and SAY which ids you resolved.\n` +
    `- Be honest about outcomes: report what tools actually returned, including rejections.\n` +
    `- Be concise and conversational. No headers, no ceremony. Reference items by their text, ` +
    `with ids in parentheses.\n` +
    `- If the request needs no tool (a question about the space), answer directly from [SPACE STATE].\n\n` +
    `GUIDED FLOW (while the space has NO items yet — the wizard-as-dialogue):\n` +
    `1. INTAKE: greet with "What do you want to build?" if the journal is empty. For EVERY message that adds ` +
    `scope, call journal_verbatim and ask what more — one short question, no analysis yet. When the message ` +
    `mixes meta-talk with content ("yes, add this: …"), extract ONLY the content via the {text} excerpt — an ` +
    `exact substring; pure confirmations ("yes", "ok") and navigation words are NOT entries, do not journal ` +
    `them. Keep going until they say it's all / that's everything.\n` +
    `2. CONTEXT: then ask what already exists that matters here, and OFFER to run contextualize. The sources ` +
    `are the PRODUCT's repositories (listed in [SPACE STATE]) — never ask for paths. When there are several, ` +
    `offer scope_context so the human narrows to the repos this space actually touches, then contextualize. ` +
    `Statements about the environment go through assumption_verbatim.\n` +
    `3. DECOMPOSE: once the digest exists (or they decline context), offer expand_space (the staged pipeline). ` +
    `Never call it uninvited — the human triggers the derivation.\n` +
    `Risk is DERIVED (a function of an element's open gaps) — never claim to set it; to lower risk, close gaps ` +
    `(research or the human resolves them). To postpone a journal entry's whole functionality, park_group its ` +
    `entry number.\n` +
    `The human may break the protocol at any time — follow them; the protocol is a guide, not a form.`
  );
}

// ── Tool executors (pure w.r.t. vscode; tested with fake sessions) ───────────

export interface ThinkyToolCtx {
  /** The human's CURRENT message, verbatim — the only sanctioned source for
   *  journal/assumption content (the model cannot paraphrase the record). */
  utterance: string;
}

export interface ThinkyToolDef {
  description: string;
  run(
    session: ThinkyAgentSessionLike,
    args: Record<string, unknown>,
    ctx: ThinkyToolCtx,
  ): Promise<string>;
}

/**
 * Verbatim-with-extraction (2026-07-17 field defect: wholesale capture
 * fossilized "yes" and "add new journal entry:" wrappers). The model may
 * TRIM the human's message to an exact contiguous excerpt — whitespace
 * normalized — but anything that is not a substring is refused, so
 * rewriting remains impossible. Returns null when the excerpt fails
 * validation; the trimmed excerpt (or whole utterance) otherwise.
 */
export function extractVerbatim(
  utterance: string,
  requested: unknown,
): string | null {
  const whole = utterance.trim();
  if (typeof requested !== "string" || !requested.trim()) return whole;
  const norm = (t: string): string => t.replace(/\s+/g, " ").trim();
  return norm(whole).includes(norm(requested)) ? norm(requested) : null;
}

function validIds(model: WorkingModel, raw: unknown): {
  valid: string[];
  unknown: string[];
} {
  const ids = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  const known = new Set<string>();
  for (const s of model.sections) for (const it of s.items) known.add(it.id);
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) (known.has(id) ? valid : unknown).push(id);
  return { valid, unknown };
}

export const THINKY_TOOLS: Record<string, ThinkyToolDef> = {
  read_space: {
    description:
      "Re-read the live space state (after your tools changed it). Returns the fresh snapshot.",
    async run(session) {
      return renderSpaceSnapshot(session);
    },
  },
  stage_items: {
    description:
      "Stage items for a HUMAN-applied verb (settle/defer/drop via buttons). Staging is not checking. Args: {itemIds: string[]}",
    async run(session, args) {
      const { valid, unknown } = validIds(session.model, args.itemIds);
      if (valid.length === 0)
        return `Nothing staged — no valid item ids given${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}.`;
      await session.postFromWebview({ type: "clearSelection" });
      for (const id of valid) {
        await session.postFromWebview({ type: "toggleSelect", itemId: id });
      }
      return `Staged ${valid.length} item(s) for the human to act on${unknown.length ? ` (ignored unknown ids: ${unknown.join(", ")})` : ""}. The human applies settle/defer/drop from the buttons.`;
    },
  },
  cut_elements: {
    description:
      "Put ELEMENT items into the TEP cut (replaces the current cut). Related context is pulled by the closure automatically. Args: {itemIds: string[]}",
    async run(session, args) {
      const { valid, unknown } = validIds(session.model, args.itemIds);
      if (valid.length === 0)
        return `Cut unchanged — no valid item ids given${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}.`;
      await session.postFromWebview({ type: "clearCut" });
      for (const id of valid) {
        await session.postFromWebview({ type: "toggleCut", itemId: id });
      }
      return (
        session.lastCommandMessage ??
        `Cut set to ${valid.length} element(s).`
      );
    },
  },
  clear_selection: {
    description: "Clear the staged-for-action selection.",
    async run(session) {
      await session.postFromWebview({ type: "clearSelection" });
      return "Selection cleared.";
    },
  },
  clear_cut: {
    description: "Clear the TEP cut.",
    async run(session) {
      await session.postFromWebview({ type: "clearCut" });
      return "Cut cleared.";
    },
  },
  check_readiness: {
    description:
      "Run the four-dimension readiness judge (convergence, precision, complexity, risk) over the cut (or all settled elements).",
    async run(session) {
      await session.postFromWebview({ type: "checkReadiness" });
      return (
        session.lastCommandMessage ??
        "Readiness check recorded — the gate report is in the thinking-space panel."
      );
    },
  },
  reframe: {
    description:
      "Re-synthesize the curated intent FROM the settled items (fails honestly when nothing is settled).",
    async run(session) {
      await session.postFromWebview({ type: "reframe" });
      return session.lastCommandMessage ?? "Reframe round completed.";
    },
  },
  contextualize: {
    description:
      "Refresh the context digest from the declared sources (grounds later rounds in what exists).",
    async run(session) {
      await session.postFromWebview({ type: "contextualize" });
      return session.lastCommandMessage ?? "Contextualize round completed.";
    },
  },
  research: {
    description:
      "Run a directed research round. Args: {subject: string, itemId?: string} — subject directs the round; itemId targets one item.",
    async run(session, args) {
      const subject =
        typeof args.subject === "string" ? args.subject.trim() : "";
      const itemId =
        typeof args.itemId === "string" && args.itemId ? args.itemId : undefined;
      await session.postFromWebview({
        type: "research",
        itemId,
        subject: subject || undefined,
      });
      return session.lastCommandMessage ?? "Research round completed.";
    },
  },
  journal_verbatim: {
    description:
      "Record a journal entry from the human's CURRENT message. Omit {text} to record the whole message verbatim; pass {text} ONLY to extract an exact contiguous excerpt of it (strip wrappers like 'add journal entry:' or a leading 'yes'). Extraction is validated mechanically — anything that is not an exact substring of their message is REJECTED, so you can trim but never rewrite.",
    async run(session, args, ctx) {
      const text = extractVerbatim(ctx.utterance, args.text);
      if (text === null)
        return "REJECTED — {text} is not an exact substring of the human's message. Trim, never rewrite; or omit {text} to record the whole message.";
      if (!text) return "Nothing recorded — empty message.";
      await session.postFromWebview({ type: "addRoughRequest", text });
      return session.lastCommandMessage ?? "Journal entry recorded verbatim.";
    },
  },
  assumption_verbatim: {
    description:
      "Record a standing assumption from the human's CURRENT message. Omit {text} for the whole message verbatim; pass {text} ONLY to extract an exact contiguous excerpt (validated mechanically — non-substrings are rejected).",
    async run(session, args, ctx) {
      const text = extractVerbatim(ctx.utterance, args.text);
      if (text === null)
        return "REJECTED — {text} is not an exact substring of the human's message. Trim, never rewrite; or omit {text}.";
      if (!text) return "Nothing recorded — empty message.";
      if (!session.dispatch) return "This surface cannot record assumptions.";
      const delta = session.dispatch({ type: "addAssumption", text });
      const kind = (delta as { kind?: string }).kind;
      if (kind !== "applied") {
        return `Assumption refused: ${(delta as { reason?: string }).reason ?? "unknown reason"}`;
      }
      return `Recorded standing assumption #${(session.model.assumptions ?? []).length} (verbatim).`;
    },
  },
  park_group: {
    description:
      "Park a journal-entry GROUP — defer its elements and their private context for a later TEP. Args: {entry: number} (the journal entry number, goal = 1). Shared context stays live.",
    async run(session, args) {
      const entry =
        typeof args.entry === "number" ? args.entry : Number(args.entry);
      if (!Number.isInteger(entry) || entry < 1)
        return "Give a journal entry number (goal = 1).";
      await session.postFromWebview({ type: "parkGroup", entry });
      return session.lastCommandMessage ?? `Parked journal entry ${entry}.`;
    },
  },
  scope_context: {
    description:
      "Present the product's candidate repositories for the human to select which the context rounds should read (a multi-select). Use in the CONTEXT phase when the product has several repos but the space likely touches only some.",
    async run(session) {
      await session.postFromWebview({ type: "command", utterance: "scope context" });
      return session.lastCommandMessage ?? "Context scope updated.";
    },
  },
  close_gaps: {
    description:
      "Run the gap-close round now: read the product sources, close every researchable gap with evidence, and recommend a decision on each decision-gap for the human to ratify. Use when there are open gaps to drive down.",
    async run(session) {
      await session.postFromWebview({ type: "command", utterance: "close gaps" });
      return session.lastCommandMessage ?? "Gap-close round done.";
    },
  },
  expand_space: {
    description:
      "Trigger the staged decomposition pipeline: elements → constraints → gap → acceptance, each stage deriving from the elements and recording its edges, then a closing integrity check. Use once intake and context are done (or the human asks to proceed).",
    async run(session) {
      await session.postFromWebview({ type: "prefill" });
      return (
        session.lastCommandMessage ??
        "Decomposition round completed — the board shows the derived items."
      );
    },
  },
};

// ── Production SDK glue ──────────────────────────────────────────────────────

/** In-memory resume ids: spaceKey → SDK session id (per extension host). */
const _agentSessions = new Map<string, string>();

export interface AgentTurnDeps {
  session: ThinkyAgentSessionLike;
  /** namespace/space — keys the persistent conversation. */
  spaceKey: string;
  model?: string;
}

/**
 * Run one agent turn: grounding + conversation resume + tool belt. Streams
 * assistant text through onText; returns true if anything was produced.
 */
export async function runThinkyAgentTurn(
  deps: AgentTurnDeps,
  prompt: string,
  onText: (chunk: string) => void,
): Promise<boolean> {
  let sdk: {
    query: (args: {
      prompt: string;
      options: Record<string, unknown>;
    }) => AsyncIterable<unknown>;
    tool: (
      name: string,
      description: string,
      schema: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => unknown;
    createSdkMcpServer: (def: {
      name: string;
      version: string;
      tools: unknown[];
    }) => unknown;
  };
  let z: typeof import("zod");
  try {
    sdk = (await import("@anthropic-ai/claude-agent-sdk")) as typeof sdk;
    z = (await import("zod")) as typeof z;
  } catch {
    return false;
  }

  const schemas: Record<string, Record<string, unknown>> = {
    read_space: {},
    stage_items: { itemIds: z.array(z.string()) },
    cut_elements: { itemIds: z.array(z.string()) },
    clear_selection: {},
    clear_cut: {},
    check_readiness: {},
    reframe: {},
    contextualize: {},
    research: { subject: z.string(), itemId: z.string().optional() },
    journal_verbatim: { text: z.string().optional() },
    assumption_verbatim: { text: z.string().optional() },
    park_group: { entry: z.number() },
    scope_context: {},
    close_gaps: {},
    expand_space: {},
  };
  const ctx = { utterance: prompt };
  const tools = Object.entries(THINKY_TOOLS).map(([name, def]) =>
    sdk.tool(name, def.description, schemas[name] ?? {}, async (args) => ({
      content: [
        {
          type: "text",
          text: await def.run(
            deps.session,
            args as Record<string, unknown>,
            ctx,
          ),
        },
      ],
    })),
  );
  const server = sdk.createSdkMcpServer({
    name: "tandem",
    version: "1.0.0",
    tools,
  });

  const resume = _agentSessions.get(deps.spaceKey);
  const fullPrompt = `${renderSpaceSnapshot(deps.session)}\n\n[USER]\n${prompt}`;

  let produced = false;
  try {
    for await (const msg of sdk.query({
      prompt: fullPrompt,
      options: {
        model: deps.model ?? "sonnet",
        permissionMode: "bypassPermissions",
        thinking: { type: "disabled" },
        systemPrompt: buildThinkySystemPrompt(),
        mcpServers: { tandem: server },
        allowedTools: Object.keys(THINKY_TOOLS).map(
          (n) => `mcp__tandem__${n}`,
        ),
        disallowedTools: [
          "Read",
          "Grep",
          "Glob",
          "Bash",
          "Write",
          "Edit",
          "NotebookEdit",
          "WebFetch",
          "WebSearch",
          "Task",
          "TodoWrite",
        ],
        ...(resume ? { resume } : {}),
      },
    })) {
      const rec = msg as Record<string, unknown>;
      if (rec.type === "system" && rec.subtype === "init") {
        const sid = rec.session_id;
        if (typeof sid === "string") _agentSessions.set(deps.spaceKey, sid);
      } else if (rec.type === "assistant") {
        const m = rec.message as { content?: unknown } | undefined;
        const content = Array.isArray(m?.content) ? m!.content : [];
        for (const b of content as Array<Record<string, unknown>>) {
          if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
            produced = true;
            onText(b.text);
          }
        }
      } else if (rec.type === "result" && typeof rec.session_id === "string") {
        _agentSessions.set(deps.spaceKey, rec.session_id);
      }
    }
  } catch {
    // Resume ids can go stale (CLI restart) — retry once fresh.
    if (resume) {
      _agentSessions.delete(deps.spaceKey);
      return runThinkyAgentTurn(deps, prompt, onText);
    }
    return produced;
  }
  return produced;
}
