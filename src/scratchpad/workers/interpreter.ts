// src/scratchpad/workers/interpreter.ts
// Command-field interpreter (SP-21/3, SL-5).
//
// interpret(utterance, model, deps) → Promise<{ actions: Action[]; message?: string }>
//
// Every returned action carries actor:"human" — the utterance IS the human's act.
// Bulk commands expand deterministically (no query round needed).
// GATES.interpreter limits the allowed vocabulary; freeze is absent.
// Gate violations and unrecognized utterances surface as { actions:[], message }
// — never thrown.

import type { Action, SectionKind, WorkingModel } from "../model";
import { GATES } from "./worker";
import type { QueryFn } from "./worker";
import { normalizeWorkerActions, renderActionGuide } from "./actionGuide";

export type UtteranceClass = "operation" | "statement" | "ask" | "question";

export interface InterpretResult {
  actions: Action[];
  /** How the utterance was classified (2026-07-17): operation (item ops),
   *  statement (standing assumption), ask (journal expansion), question
   *  (answer only). Absent for deterministic bulk paths. */
  classify?: UtteranceClass;
  /**
   * Item ids STAGED for a human-applied action (selection-for-action).
   * Strictly distinct from checking: checked items are settled into the TEP;
   * staged items are ephemeral until the human applies a verb or clears.
   * Destructive verbs (drop/defer/supersede) NEVER come back as actions —
   * their targets come back here instead.
   */
  selectedItemIds?: string[];
  message?: string;
}

/** Destructive verbs are never applied from an utterance in one step — their
 *  targets are converted to a selection the human acts on explicitly. */
const DESTRUCTIVE: ReadonlySet<string> = new Set([
  "dropItem",
  "deferItem",
  "supersedeItem",
]);

// ── Section-kind noun map ─────────────────────────────────────────────────────
// Maps the nouns a human might say to a section kind.

const SECTION_NOUN_MAP: Record<string, SectionKind> = {
  // singular and plural forms
  constraint: "constraints",
  constraints: "constraints",
  element: "elements",
  elements: "elements",
  gap: "gap",
  gaps: "gap",
  criteria: "criteria",
  criterion: "criteria",
  verification: "verification",
  verifications: "verification",
  list: "constraints", // generic "list" falls through to constraints; see "all lists"
};

// ── Bulk-expansion helpers ────────────────────────────────────────────────────

/**
 * "accept all <noun>" → checkItem for every unchecked active item in the named section.
 * "accept all lists" → checkItem for every unchecked active item in ALL sections.
 *
 * Returns null if the utterance does not match a known bulk pattern.
 */
function tryBulkExpansion(
  utterance: string,
  model: WorkingModel,
): Action[] | null {
  const lower = utterance.trim().toLowerCase();

  // "accept all lists" / "accept all" (no noun) → all sections
  if (lower === "accept all lists" || lower === "accept all") {
    const actions: Action[] = [];
    for (const section of model.sections) {
      for (const item of section.items) {
        if (!item.checked && item.state === "active") {
          actions.push({
            type: "checkItem",
            actor: "human",
            itemId: item.id,
          });
        }
      }
    }
    return actions;
  }

  // "accept all <noun>" where <noun> maps to a known section kind
  const acceptAllMatch = lower.match(/^accept\s+all\s+(\w+)$/);
  if (acceptAllMatch) {
    const noun = acceptAllMatch[1];
    const kind = SECTION_NOUN_MAP[noun];
    if (kind !== undefined) {
      const section = model.sections.find((s) => s.kind === kind);
      if (!section) {
        return []; // section kind not in model → no-op (not an error)
      }
      const actions: Action[] = [];
      for (const item of section.items) {
        if (!item.checked && item.state === "active") {
          actions.push({
            type: "checkItem",
            actor: "human",
            itemId: item.id,
          });
        }
      }
      return actions;
    }
  }

  return null; // not a recognized bulk pattern
}

// ── Gate-safe query round ─────────────────────────────────────────────────────

/**
 * Run a query round for the utterance, then filter any action that violates
 * GATES.interpreter (notably freeze). Returns actions + an optional message
 * explaining a gate refusal or an empty result.
 */
async function queryRound(
  utterance: string,
  model: WorkingModel,
  loadQuery: () => QueryFn,
): Promise<InterpretResult> {
  // Build QueryOptions from GATES.interpreter
  const options = {
    model: "sonnet",
    allowedTools: GATES.interpreter.allowedTools,
    disallowedTools: GATES.interpreter.disallowedTools,
  };

  const prompt =
    `You are a command-field interpreter. FIRST classify the human's utterance:\n` +
    `- "operation": it names item operations (accept/check/drop/defer/set/select…) → translate to actions.\n` +
    `- "statement": it asserts a standing FACT or constraint about the world/environment ` +
    `("this is a single-user development platform") → NO actions; just classify.\n` +
    `- "ask": it requests NEW scope/capability ("also handle X") → NO actions; just classify.\n` +
    `- "question": it asks for information → NO actions; just classify.\n` +
    `Then, for "operation" only, translate into structured actions. Every action you produce MUST carry actor:"human". ` +
    `A command may name items semantically (e.g. "the implementation-flavored items") — judge which ` +
    `items match, using the exact itemId values from the working model.\n\n` +
    `THE SPACE HAS TWO DISTINCT SELECTIONS — never confuse them:\n` +
    `1. CHECKING an item (checkItem/uncheckItem) is the human's SETTLING act: checked items become ` +
    `part of the next TEP. Emit these ONLY when the human's words are about accepting/settling ` +
    `("accept", "check", "settle", "confirm").\n` +
    `2. SELECTING items stages them for a later human-applied action. For commands that pick out a ` +
    `set of items ("select the …", "drop the …", "defer the …", "get rid of …"), return the matching ` +
    `ids in the top-level "select" array and DO NOT emit dropItem/deferItem/supersedeItem actions — ` +
    `the human applies the verb from the selection bar. Destructive actions you emit anyway are ` +
    `converted to a selection, never applied directly.\n\n` +
    `Freeze is NOT available — do not produce a freeze action. ` +
    `If the command cannot be translated at all, return zero actions and an empty select.\n\n` +
    `Working model (JSON):\n${JSON.stringify(model, null, 2)}\n\n` +
    `${renderActionGuide(model, GATES.interpreter.allowedTools, "human")}\n\n` +
    `Human command: "${utterance}"\n\n` +
    `Respond with a JSON object: { "classify": "operation"|"statement"|"ask"|"question", "actions": [...], "select": ["<itemId>", ...], "message": "optional explanation" }`;

  const query = loadQuery();
  const rawActions: Action[] = [];
  const rawSelect: string[] = [];
  let classify: UtteranceClass | undefined;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "actions") {
      rawActions.push(...msg.actions);
      if (msg.select) rawSelect.push(...msg.select);
      if (
        msg.classify === "operation" ||
        msg.classify === "statement" ||
        msg.classify === "ask" ||
        msg.classify === "question"
      ) {
        classify = msg.classify;
      }
    }
  }

  // Validation seam (same as the worker rounds): coerce/verify every action
  // against the live model and the interpreter gate; every survivor is stamped
  // actor:"human". A malformed or out-of-gate emission becomes a readable
  // message, never a silent no-op or a reducer throw.
  const { valid, rejected } = normalizeWorkerActions(
    rawActions as unknown[],
    model,
    { defaultActor: "human", allowedTools: GATES.interpreter.allowedTools },
  );

  // Selection-for-action: validated "select" ids, PLUS the targets of any
  // destructive action the model emitted directly (converted, never applied).
  const liveIds = collectItemIds(model);
  const staged = new Set<string>(rawSelect.filter((id) => liveIds.has(id)));
  const validActions: Action[] = [];
  for (const a of valid) {
    if (DESTRUCTIVE.has(a.type)) {
      const itemId = (a as { itemId?: string }).itemId;
      if (itemId !== undefined) staged.add(itemId);
      continue;
    }
    validActions.push(a);
  }
  const selectedItemIds = [...staged];

  if (
    validActions.length === 0 &&
    selectedItemIds.length === 0 &&
    rejected.length > 0
  ) {
    return {
      actions: [],
      classify,
      message: `Command not applied: ${rejected[0].reason}`,
    };
  }

  // Non-operation classes return empty-handed BY DESIGN — the session routes
  // them (statement → assumption+challenger; ask → journal; question →
  // respond-only round).
  if (
    classify === "statement" ||
    classify === "ask" ||
    classify === "question"
  ) {
    return { actions: [], classify };
  }

  // Nothing at all → unrecognized utterance
  if (validActions.length === 0 && selectedItemIds.length === 0) {
    return {
      actions: [],
      classify,
      message:
        `I didn't understand "${utterance}". ` +
        `Try commands like "accept all constraints", "select the <description> items", or "reframe".`,
    };
  }

  const result: InterpretResult = { actions: validActions };
  if (classify !== undefined) result.classify = classify;
  if (selectedItemIds.length > 0) {
    result.selectedItemIds = selectedItemIds;
  }
  if (rejected.length > 0) {
    result.message = `Skipped ${rejected.length} malformed action(s): ${rejected[0].reason}`;
  }
  return result;
}

/** Collect the set of item ids currently in the model. */
function collectItemIds(model: WorkingModel): Set<string> {
  const ids = new Set<string>();
  for (const section of model.sections) {
    for (const item of section.items) {
      ids.add(item.id);
    }
  }
  return ids;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Interpret a plain-language utterance into human-attributed model actions.
 *
 * - Bulk "accept all …" commands expand deterministically (no query round).
 * - Other utterances are routed through the model connection.
 * - Any action violating GATES.interpreter (including freeze) is caught inside
 *   interpret and surfaces as { actions:[], message } — never thrown.
 * - An unrecognized utterance returns { actions:[], message } with a plain
 *   explanation.
 */
export async function interpret(
  utterance: string,
  model: WorkingModel,
  deps: { loadQuery: () => QueryFn },
): Promise<InterpretResult> {
  // 1. Try deterministic bulk expansion first
  const bulkActions = tryBulkExpansion(utterance, model);
  if (bulkActions !== null) {
    return { actions: bulkActions };
  }

  // 2. Fall through to model round
  try {
    return await queryRound(utterance, model, deps.loadQuery);
  } catch (err) {
    // Unexpected error from the query itself — surface as message, no throw
    const msg = err instanceof Error ? err.message : String(err);
    return {
      actions: [],
      message: `Command failed: ${msg}`,
    };
  }
}
