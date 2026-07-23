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
 *  - HUMAN SOVEREIGNTY is COMMANDING, not clicking: the agent may settle,
 *    defer, drop and revise, but only on an explicit order, always via
 *    select-then-act so the human sees the set first. Freeze and panic are
 *    never the agent's — they stay on the board behind their own modals.
 *  - Model: pinned to sonnet (the chat routes and narrates; design/audit
 *    cognition lives in the worker rounds with their own role-based models).
 *
 * Pure parts (snapshot renderer, system prompt, tool executors) are
 * vscode-free and tested; the SDK glue is a thin production thunk.
 */

import type { Delta, WorkingModel } from "../model";
import { entriesOf, isAttributed } from "../model";
import type { ScratchpadInboundMessage } from "../session";
import { computeElementRisk } from "../deriveRisk";
import { computeIntegrity, integritySummary } from "../integrityGate";
import type { ItemQuery } from "../query";
import { findItems, indexItems, renderHits } from "../query";

/** The narrow session surface the agent's tools need. */
export interface ThinkyAgentSessionLike {
  readonly model: WorkingModel;
  readonly lastCommandMessage: string | undefined;
  readonly selectionCount?: number;
  readonly selectedItemIds?: readonly string[];
  readonly contextSources?: readonly string[];
  postFromWebview(message: ScratchpadInboundMessage): Promise<void>;
  dispatch?(action: unknown): Delta;
  /** Revision — optional, so a surface that cannot revise simply omits it. */
  readonly revisionDraft?: { entry: number; text: string };
  readonly entryConcerns?: readonly {
    entry: number;
    kind: string;
    why: string;
    suggestedText?: string;
  }[];
  stageRevision?(entry: number, text: string): string;
  dryRunRevision?(): Promise<string>;
  applyRevision?(): Promise<string>;
  discardRevision?(): string;
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
  // Item ids → text, so edges can be shown as readable names.
  const nameOf = new Map<string, string>();
  for (const sec of model.sections)
    for (const it of sec.items) nameOf.set(it.id, it.text);

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
      const serves = entriesOf(model, it);
      marks.push(
        isAttributed(it) ? `entry ${serves.join("/")}` : "whole-space",
      );
      if ((it.flaggedBy ?? []).length > 0) marks.push("protected");
      // CHEAP SIGNALS ONLY — the index says what exists and flags where depth
      // is available; `inspect_item` fetches the reasoning on demand. Inlining
      // every note/rationale/evidence would inflate every turn's prompt to pay
      // for detail that most turns never use.
      if (it.decisionProposal) marks.push("DECISION-PENDING");
      if (it.notes.length > 0) marks.push(`${it.notes.length}n`);
      if (it.evidence.length > 0) marks.push(`${it.evidence.length}ev`);
      lines.push(
        `  - ${it.id}${marks.length ? ` [${marks.join(",")}]` : ""} ${it.text.slice(0, 200)}`,
      );
    }
  }
  // Structural health — one cheap line the board also surfaces.
  const integrity = computeIntegrity(model);
  if (!integrity.clean) lines.push(integritySummary(integrity));
  if (model.curatedTitle) lines.push(`Curated intent: ${model.curatedTitle}`);
  if (session.contextSources?.length) {
    lines.push(
      `Declared context sources (expand reads EXACTLY these when it derives — narrow them with scope_context, never by typing paths): ${session.contextSources.join(", ")}`,
    );
  }
  if (session.entryConcerns?.length) {
    lines.push("Journal entries a round flagged as themselves at fault:");
    for (const c of session.entryConcerns)
      lines.push(
        `  entry ${c.entry} — ${c.kind}: ${c.why}` +
          (c.suggestedText ? `\n    suggested wording: ${c.suggestedText}` : ""),
      );
  }
  if (session.revisionDraft) {
    lines.push(
      `Revision drafted (NOT applied) for journal entry ${session.revisionDraft.entry}: ` +
        `"${session.revisionDraft.text.slice(0, 200)}"`,
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
    : `${out.slice(0, 12000)}\n[snapshot clipped — use find_items/inspect_item for anything not listed]`;
}

export function buildThinkySystemPrompt(): string {
  return (
    `You are Thinky, the Thinkube tandem thinking-space assistant. You converse with the human ` +
    `about their design intent and act on the space ONLY through your tools.\n\n` +
    `Doctrine (non-negotiable):\n` +
    `- HUMAN SOVEREIGNTY means the human COMMANDS, not that they click. You may settle, unsettle, defer and ` +
    `drop — but ONLY on their explicit order, never on your own initiative and never as a helpful extra. ` +
    `Freeze and panic are not yours at any time; they stay on the board.\n` +
    `- Work in two steps, always: SELECT then ACT. select_items resolves the human's phrasing into a staged ` +
    `set; you report that set back in their language; apply_verb then acts on it. Show the set before acting ` +
    `unless they already named it exactly — a wrong selection acted on silently is the one unrecoverable ` +
    `mistake here.\n` +
    `- Selection is by CRITERIA, not by hand-listing ids. "the constraints for the first element" is ` +
    `select_items{kind:'constraints', relatedTo:<that element's id>}; "everything from my third ask" is ` +
    `{servesEntry:3}; "the risky ones" is {riskAtLeast:3}. Never infer which items are related — ask ` +
    `find_items/select_items, which follow the real dependency edges.\n` +
    `- For the acts that remain the human's: freeze = the board's Freeze button once the gate is green; ` +
    `panic (wipe derived state, keep the journal) = the Panic button in the board's top bar; deleting a ` +
    `mis-captured journal entry = the ✕ next to it in the board's Journal fold. Point at the real control; ` +
    `never invent UI.\n` +
    `- Dropping a constraint the machine DECIDED re-opens the gap it settled — the question returns ` +
    `unanswered rather than the space pretending it is closed. Say so before you drop one.\n` +
    `- The journal is a DRAFT, not an axiom — creativity is iterative. When the human says an ask was ` +
    `WRONG (not merely incomplete), propose_revision drafts a new wording and shows what it would cost; ` +
    `refine the text with them for free, offer test_revision to see what it would break, and apply_revision ` +
    `only on their order. When the ask is merely INCOMPLETE, journal a new entry instead — revision deletes ` +
    `what the old wording produced, so never reach for it to add something.\n` +
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
    `them. When the human PASTES A LIST (several lines or bullets, each a distinct ask), call journal_list ` +
    `once — it records one independent entry per line. Keep going until they say it's all / that's everything.\n` +
    `2. SCOPE: the sources expand reads are the PRODUCT's repositories (listed in [SPACE STATE]) — never ask ` +
    `for paths. When there are several, offer scope_context so the human narrows to the repos this space ` +
    `actually touches. Statements about the environment go through assumption_verbatim. Do NOT offer a ` +
    `separate contextualize step — expand reads the scoped sources per ask on its own.\n` +
    `3. DECOMPOSE: offer expand_space (the staged pipeline — it reads context for each journal ask, then ` +
    `derives elements, constraints, gaps and acceptance, and closes what it can). Never call it uninvited — ` +
    `the human triggers the derivation.\n` +
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

/**
 * Split a pasted list into one journal entry per line. Blank lines are
 * dropped and a leading list marker (-, *, •, –, a number like "1." or "2)",
 * or a "[ ]"/"[x]" checkbox) is stripped. Marker removal only trims the ends
 * of a line, so every returned entry is still a contiguous slice of the
 * human's own words — nothing is rewritten.
 */
export function splitJournalList(utterance: string): string[] {
  return utterance
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*•–]|\d+[.)]|\[[ xX]?\])\s+/, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
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

/**
 * Read the query criteria out of a tool call. Unknown keys are ignored rather
 * than guessed at, so a malformed call selects nothing instead of everything.
 */
function toQuery(args: Record<string, unknown>): ItemQuery {
  const q: ItemQuery = {};
  const kinds = ["elements", "constraints", "gap", "acceptance"] as const;
  if (typeof args.kind === "string" &&
      (kinds as readonly string[]).includes(args.kind))
    q.kind = args.kind as ItemQuery["kind"];
  if (typeof args.relatedTo === "string" && args.relatedTo)
    q.relatedTo = args.relatedTo;
  if (typeof args.servesEntry === "number") q.servesEntry = args.servesEntry;
  if (typeof args.settled === "boolean") q.settled = args.settled;
  if (typeof args.state === "string")
    q.state = args.state as ItemQuery["state"];
  if (typeof args.riskAtLeast === "number") q.riskAtLeast = args.riskAtLeast;
  if (typeof args.complexityAtLeast === "number")
    q.complexityAtLeast = args.complexityAtLeast;
  if (typeof args.hasDecisionPending === "boolean")
    q.hasDecisionPending = args.hasDecisionPending;
  if (typeof args.textMatches === "string" && args.textMatches)
    q.textMatches = args.textMatches;
  if (typeof args.unattributed === "boolean")
    q.unattributed = args.unattributed;
  if (typeof args.isProtected === "boolean") q.isProtected = args.isProtected;
  return q;
}

export const THINKY_TOOLS: Record<string, ThinkyToolDef> = {
  find_items: {
    description:
      "Resolve items by CRITERIA (read-only — changes nothing). Args, all optional and combined with AND: " +
      "{kind: 'elements'|'constraints'|'gap'|'acceptance', relatedTo: itemId, servesEntry: number, " +
      "settled: boolean, state: 'active'|'shipped'|'deferred'|'dropped'|'any', riskAtLeast, complexityAtLeast, " +
      "hasDecisionPending, textMatches, unattributed, isProtected}. " +
      "relatedTo follows the dependency graph: give an ELEMENT id to get everything belonging to it " +
      "(its constraints, their gaps, the acceptance), or any other id to get what shares its elements. " +
      "Use this to answer 'which items…' questions and to check a set BEFORE selecting it.",
    async run(session, args) {
      const q = toQuery(args);
      const hits = findItems(session.model, q);
      return `${hits.length} item(s) match:\n${renderHits(hits)}`;
    },
  },
  select_items: {
    description:
      "Stage items by CRITERIA for a verb — same arguments as find_items, plus optional {itemIds: string[]} " +
      "to stage explicit ids instead. This REPLACES the current staged selection. Always report back which " +
      "items you staged (by text) so the human can see the set before ordering a verb.",
    async run(session, args) {
      const explicit = Array.isArray(args.itemIds)
        ? validIds(session.model, args.itemIds).valid
        : undefined;
      const hits = explicit
        ? findItems(session.model, { state: "any" }).filter((h) =>
            explicit.includes(h.id),
          )
        : findItems(session.model, toQuery(args));
      await session.postFromWebview({ type: "clearSelection" });
      if (hits.length === 0)
        return "Nothing staged — no items match those criteria. Selection cleared.";
      for (const h of hits)
        await session.postFromWebview({ type: "toggleSelect", itemId: h.id });
      return `Staged ${hits.length} item(s):\n${renderHits(hits)}`;
    },
  },
  apply_verb: {
    description:
      "Apply a verb to the STAGED selection, on the human's explicit order. Args: " +
      "{verb: 'settle'|'unsettle'|'defer'|'drop'}. NEVER call this uninvited — the human must ask for the " +
      "action. Freezing and panic are not verbs here; they stay on the board.",
    async run(session, args) {
      const map: Record<string, "check" | "uncheck" | "defer" | "drop"> = {
        settle: "check",
        check: "check",
        unsettle: "uncheck",
        uncheck: "uncheck",
        defer: "defer",
        drop: "drop",
      };
      const verb = map[String(args.verb ?? "").toLowerCase()];
      if (!verb)
        return "Unknown verb — use settle, unsettle, defer or drop.";
      if ((session.selectionCount ?? 0) === 0)
        return "Nothing is staged — select items first, then apply the verb.";
      await session.postFromWebview({ type: "applySelection", verb });
      return session.lastCommandMessage ?? `Applied ${args.verb}.`;
    },
  },
  inspect_item: {
    description:
      "Read ONE item in full: its rationale, notes, evidence, dependencies, evals and any pending decision. " +
      "The space snapshot is an index — use this whenever the human asks why an item exists, where a score " +
      "came from, or what a decision recommends. Args: {itemId: string}",
    async run(session, args) {
      const id = typeof args.itemId === "string" ? args.itemId : "";
      const byId = indexItems(session.model);
      const found = byId.get(id);
      if (!found) return `No item with id ${id || "(none given)"}.`;
      const { kind, item } = found;
      const nameOf = (x: string): string =>
        byId.get(x)?.item.text.slice(0, 80) ?? x;
      const out: string[] = [`${item.id} [${kind}] ${item.text}`];
      out.push(
        `state: ${item.state}${item.checked ? " (settled)" : ""}` +
          `${isAttributed(item) ? ` · journal entry ${entriesOf(session.model, item).join(", ")}` : " · applies to the whole space"}` +
          `${item.modality ? ` · ${item.modality}` : ""}`,
      );
      if (kind === "elements" && item.state === "active") {
        const r = computeElementRisk(session.model, item.id);
        out.push(`risk: R${r.score} (derived from its open gaps)`);
      } else if (item.evals.risk !== undefined) {
        out.push(`risk: R${item.evals.risk}${item.rationale?.risk ? ` — ${item.rationale.risk}` : ""}`);
      }
      if (item.evals.complexity !== undefined)
        out.push(
          `complexity: C${item.evals.complexity}${item.rationale?.complexity ? ` — ${item.rationale.complexity}` : ""}`,
        );
      if (item.decidedFrom)
        out.push(
          `decided by the machine to settle gap ${item.decidedFrom} — dropping this constraint RE-OPENS that gap`,
        );
      if (item.decisionProposal)
        out.push(
          `DECISION PENDING — recommends: ${item.decisionProposal.recommendation}\n` +
            `  reasoning: ${item.decisionProposal.reasoning}`,
        );
      if ((item.requires ?? []).length > 0)
        out.push(
          `requires:\n${item.requires!.map((r) => `  - ${r} (${nameOf(r)})`).join("\n")}`,
        );
      const dependents = [...byId.values()].filter((v) =>
        (v.item.requires ?? []).includes(item.id),
      );
      if (dependents.length > 0)
        out.push(
          `required by:\n${dependents.map((d) => `  - ${d.item.id} [${d.kind}] ${d.item.text.slice(0, 80)}`).join("\n")}`,
        );
      if (item.notes.length > 0)
        out.push(
          `notes:\n${item.notes.map((n) => `  - (${n.by}) ${n.text}`).join("\n")}`,
        );
      if (item.evidence.length > 0)
        out.push(
          `evidence:\n${item.evidence.map((e) => `  - ${e.source} (${e.method})`).join("\n")}`,
        );
      if (item.accepted?.risk)
        out.push(`risk accepted by the human: ${item.accepted.risk.reason}`);
      if (item.accepted?.complexity)
        out.push(
          `complexity accepted by the human: ${item.accepted.complexity.reason}`,
        );
      if ((item.flaggedBy ?? []).length > 0)
        out.push(`protected — served as context for ${item.flaggedBy!.join(", ")}`);
      if (item.shippedIn) out.push(`shipped in ${item.shippedIn}`);
      return out.join("\n");
    },
  },
  propose_revision: {
    description:
      "Draft a NEW WORDING for a journal entry and show what applying it would cost. Args: " +
      "{entry: number (goal = 1), text: string}. Changes NOTHING — it holds a draft and returns a preview " +
      "of what would be deleted and what would survive. Call it again to refine the wording; the human " +
      "argues with the text for free. Use whenever they say an ask was WRONG, not merely incomplete " +
      "(a genuinely new requirement is a new journal entry instead).",
    async run(session, args) {
      const entry =
        typeof args.entry === "number" ? args.entry : Number(args.entry);
      const text = typeof args.text === "string" ? args.text : "";
      if (!Number.isInteger(entry) || entry < 1)
        return "Give the journal entry number to revise (goal = 1).";
      if (!session.stageRevision) return "This surface cannot draft revisions.";
      return session.stageRevision(entry, text);
    },
  },
  test_revision: {
    description:
      "Dry-run the drafted revision: judge the NEW wording against the items that would survive it, and " +
      "report what it would contradict — including anything a frozen TEP already shipped, which the " +
      "revision cannot change. Changes nothing. Offer this when the human is weighing a rewording.",
    async run(session) {
      if (!session.dryRunRevision) return "This surface cannot test revisions.";
      return session.dryRunRevision();
    },
  },
  apply_revision: {
    description:
      "Commit the drafted revision on the human's explicit order: delete what the old wording produced " +
      "(shipped and TEP-protected items survive), rewrite the entry, and re-derive it. DESTRUCTIVE and not " +
      "undoable — never call it without a clear order, and only once they have seen the preview.",
    async run(session) {
      if (!session.applyRevision) return "This surface cannot apply revisions.";
      return session.applyRevision();
    },
  },
  discard_revision: {
    description: "Throw away the drafted revision, leaving the entry as it is.",
    async run(session) {
      if (!session.discardRevision)
        return "This surface cannot discard revisions.";
      return session.discardRevision();
    },
  },
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
      "OPTIONAL PREVIEW ONLY — regenerate each ask's context digest (research/_ask-<n>.md) so the human can " +
      "audit what expand will read. Expand already does this itself; never offer this as a required step — " +
      "run it only when the human explicitly asks to preview or debug the context.",
    async run(session) {
      await session.postFromWebview({ type: "contextualize" });
      return session.lastCommandMessage ?? "Per-ask context digests regenerated.";
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
  journal_list: {
    description:
      "Record MANY independent journal entries at once from a LIST the human pasted in their CURRENT message — one entry per line/bullet. Use this (not journal_verbatim) whenever the message is a multi-line or bulleted list of distinct asks. List markers are stripped; each entry stays an exact slice of their words. If the journal is empty, the first entry seeds the goal.",
    async run(session, _args, ctx) {
      const entries = splitJournalList(ctx.utterance);
      if (entries.length === 0) return "Nothing recorded — no list items found.";
      if (entries.length === 1) {
        await session.postFromWebview({ type: "addRoughRequest", text: entries[0] });
        return session.lastCommandMessage ?? "Recorded 1 journal entry.";
      }
      for (const text of entries) {
        await session.postFromWebview({ type: "addRoughRequest", text });
      }
      return `Recorded ${entries.length} independent journal entries from the pasted list.`;
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
      "Run the gap-close round now: resolve every researchable gap with evidence, DECIDE the decidable implementation gaps into constraints (the human reviews/overrides them — non-blocking), and recommend a decision only on genuine intent forks for the human to ratify. Use when there are open gaps to drive down.",
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

  const criteria = {
    kind: z.string().optional(),
    relatedTo: z.string().optional(),
    servesEntry: z.number().optional(),
    settled: z.boolean().optional(),
    state: z.string().optional(),
    riskAtLeast: z.number().optional(),
    complexityAtLeast: z.number().optional(),
    hasDecisionPending: z.boolean().optional(),
    textMatches: z.string().optional(),
    unattributed: z.boolean().optional(),
    isProtected: z.boolean().optional(),
  };
  const schemas: Record<string, Record<string, unknown>> = {
    propose_revision: { entry: z.number(), text: z.string() },
    test_revision: {},
    apply_revision: {},
    discard_revision: {},
    find_items: criteria,
    select_items: { ...criteria, itemIds: z.array(z.string()).optional() },
    apply_verb: { verb: z.string() },
    inspect_item: { itemId: z.string() },
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
    journal_list: {},
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
