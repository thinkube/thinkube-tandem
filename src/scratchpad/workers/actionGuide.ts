/**
 * Action guide + normalization seam for scratchpad worker rounds.
 *
 * Root cause this module removes (field defect, 2026-07-16): worker prompts told
 * the model to "conform to the Action type" without ever SHOWING the Action type,
 * and listed sections by kind label without disclosing sectionId — so a worker
 * could not possibly emit a valid `proposeItem`. It invented a plausible shape
 * ({"tool":"proposeItem","section":"Context","text":...}) which the reducer's
 * exhaustive switch rejected with a raw throw, aborting the round mid-dispatch
 * (actions before the bad one already applied — partial application).
 *
 * Two sanctioned paths replace the guessing game:
 *
 *  - renderActionGuide(): a prompt block carrying the live sectionId/itemId
 *    values and an exact JSON worked example for every tool the worker's gate
 *    allows. ID lists are included ONLY when an allowed tool consumes them, so
 *    prompts with deliberate blindness (reframe: checked-items-only) leak nothing.
 *
 *  - normalizeWorkerActions(): the validation seam between parsed worker JSON
 *    and the reducer. Coerces common aliases ("tool" → "type", section kind
 *    name → sectionId, flat "text" → item object), enforces the worker's gate
 *    mechanically, and turns everything unsalvageable into a rejected entry
 *    with a reason — a malformed action can no longer abort a round or reach
 *    the reducer's throw sites.
 */

import type {
  Action,
  ComplexityFactor,
  Evidence,
  Modality,
  RiskFactor,
  ToolName,
  WorkingModel,
} from "../model";
import { COMPLEXITY_FACTORS, RISK_FACTORS } from "../model";

/** Worker actors — every scratchpad round actor except the human. */
export type WorkerActor = "gap-filler" | "integrator" | "research";

/** The actor a normalized round stamps: a worker actor, or "human" for the
 *  command-field interpreter (the utterance IS the human's act). */
export type RoundActor = WorkerActor | "human";

export interface RejectedAction {
  raw: unknown;
  reason: string;
}

export interface NormalizeResult {
  valid: Action[];
  rejected: RejectedAction[];
}

export interface NormalizeOptions {
  defaultActor: RoundActor;
  allowedTools: ToolName[];
  /** ISO timestamp used to fill a missing evidence.checkedAt (research rounds). */
  nowIso?: string;
}

// Tools a worker round may express through this seam.
const WORKER_EMITTABLE: ReadonlySet<string> = new Set([
  "proposeItem",
  "proposeEdit",
  "addItemNote",
  "attachEvidence",
  "editGoal",
  "curateIntent",
  "addObjection",
  "linkItems",
]);

// The command-field interpreter's human vocabulary (GATES.interpreter).
// Every one of these is stamped actor:"human" on normalization — the
// utterance is the human's act, whatever the model claims.
const HUMAN_EMITTABLE: ReadonlySet<string> = new Set([
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
]);

// Anything outside both sets (freeze, …) is rejected regardless of gate.
const EMITTABLE: ReadonlySet<string> = new Set([
  ...WORKER_EMITTABLE,
  ...HUMAN_EMITTABLE,
]);

const SECTION_TAKING: ReadonlySet<string> = new Set(["proposeItem", "addItem"]);
const ITEM_TAKING: ReadonlySet<string> = new Set([
  "linkItems",
  "proposeEdit",
  "addItemNote",
  "attachEvidence",
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
]);

// ── Small coercion helpers ───────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function asEvalValue(v: unknown): 1 | 2 | 3 | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return n === 1 || n === 2 || n === 3 ? n : undefined;
}

function asModality(v: unknown): Modality {
  return v === "mandatory" ? "mandatory" : "optional";
}

function asWorkerActor(v: unknown, fallback: RoundActor): WorkerActor {
  if (v === "gap-filler" || v === "integrator" || v === "research") return v;
  // Worker-only actions can never carry "human" (unreachable in practice: the
  // interpreter's gate contains no worker-only tools).
  return fallback === "human" ? "integrator" : fallback;
}

/** Resolve a section reference: exact id first, then kind name (case-insensitive). */
function resolveSectionId(model: WorkingModel, ref: unknown): string | null {
  const s = asNonEmptyString(ref);
  if (s === null) return null;
  const byId = model.sections.find((sec) => sec.id === s);
  if (byId) return byId.id;
  const kind = s.trim().toLowerCase();
  const byKind = model.sections.find((sec) => sec.kind === kind);
  return byKind ? byKind.id : null;
}

function sectionKindOf(model: WorkingModel, sectionId: string): string | null {
  const sec = model.sections.find((s) => s.id === sectionId);
  return sec ? sec.kind : null;
}

/** Resolve an item reference to an existing item id (exact match only). */
function resolveItemId(model: WorkingModel, ref: unknown): string | null {
  const s = asNonEmptyString(ref);
  if (s === null) return null;
  for (const sec of model.sections) {
    if (sec.items.some((it) => it.id === s)) return s;
  }
  return null;
}

// ── renderActionGuide ────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Render the prompt block disclosing the exact action contract for one worker
 * round: live IDs (only those the gate's tools consume) plus an exact JSON
 * worked example per allowed tool.
 */
export function renderActionGuide(
  model: WorkingModel,
  allowedTools: ToolName[],
  actor: RoundActor,
): string {
  const allowed = allowedTools.filter((t) => EMITTABLE.has(t));
  const needsSections = allowed.some((t) => SECTION_TAKING.has(t));
  const needsItems = allowed.some((t) => ITEM_TAKING.has(t));

  const lines: string[] = [
    "## How to emit actions (exact contract — malformed actions are rejected)",
    "",
    'Respond with EXACTLY ONE JSON object: {"actions":[ ...action objects... ]}',
    'Every action object uses the key "type" (never "tool" or "name"), shaped exactly as shown below.',
  ];

  const nonGoalSections = model.sections.filter((s) => s.kind !== "goal");
  const exampleSectionId =
    nonGoalSections.length > 0 ? nonGoalSections[0].id : "<sectionId>";

  if (needsSections) {
    lines.push("", "Live sections — the ONLY sectionId values you may target:");
    for (const sec of nonGoalSections) {
      lines.push(`- "${sec.id}" (the ${sec.kind} section)`);
    }
    if (nonGoalSections.length === 0) {
      lines.push("- (none yet)");
    }
  }

  let exampleItemId = "<itemId>";
  if (needsItems) {
    const itemLines: string[] = [];
    for (const sec of model.sections) {
      for (const it of sec.items) {
        if (itemLines.length === 0) exampleItemId = it.id;
        itemLines.push(`- "${it.id}" [${sec.kind}] "${truncate(it.text, 80)}"`);
      }
    }
    lines.push("", "Live items — the ONLY itemId values you may target:");
    lines.push(...(itemLines.length > 0 ? itemLines : ["- (none yet)"]));
  }

  const shapes: Partial<Record<ToolName, string>> = {
    proposeItem:
      `{"type":"proposeItem","actor":"${actor}","sectionId":"${exampleSectionId}",` +
      `"item":{"text":"<the item text>","modality":"optional","evals":{"complexity":2,"risk":1},` +
      `"factors":{"complexity":"interactions","risk":"irreversible"},` +
      `"note":"Why: <role in the intent>. Impact: <what it commits to / what dropping loses>. Modality: <why this classification>.",` +
      `"requires":["<itemId of an existing item, or the EXACT text of an item you proposed earlier in this same response>"]}}` +
      ` — modality doctrine: "mandatory" = the intent CANNOT be delivered without this item; ` +
      `"optional" = valuable, but the intent survives without it. Classify honestly per item, never by default. ` +
      `Eval doctrine — every score MUST name its factor in "factors" (a score without a factor is unexplainable and will be challenged). ` +
      `Scores: 1 = well-understood/cheap to be wrong about; 2 = several moving parts / rework cost; 3 = needs research or decomposition before settling / a wrong call endangers the intent. ` +
      `Complexity factors: interactions (entangled with other items), novelty (uncharted — nothing known covers it), ambiguity (several plausible readings), decomposition (resists clean cutting), external-coupling (behavior outside our control). ` +
      `Risk factors: irreversible (cannot be cheaply undone), blast-radius (many items depend on it), unverified-assumption (load-bearing claim, no evidence), external-dependency (undocumented/uncontrolled behavior), integrity (security/data-loss/signed-artifact class), hack-debt (a known shortcut being accepted). ` +
      `Omit a facet entirely if genuinely unsure. ALWAYS include the note — the human decides on it. ` +
      `Dependency doctrine: whenever an item's Why references another item, DECLARE the edge in "requires" — ` +
      `a dependency that lives only in prose silently goes stale when the other item is dropped. Omit "requires" when there is none`,
    proposeEdit: `{"type":"proposeEdit","actor":"${actor}","itemId":"${exampleItemId}","newText":"<replacement text>"}`,
    addItemNote: `{"type":"addItemNote","actor":"${actor}","itemId":"${exampleItemId}","text":"<the note>"}`,
    attachEvidence:
      `{"type":"attachEvidence","actor":"${actor}","itemId":"${exampleItemId}",` +
      `"evidence":{"source":"<where>","method":"<how verified>","checkedAt":"<ISO timestamp>","dossierRef":"research/<topic>.md"}}`,
    editGoal: `{"type":"editGoal","text":"<the rewritten goal statement>"}`,
    curateIntent: `{"type":"curateIntent","title":"<crisp TEP title — max 80 characters, a headline not a sentence dump>","text":"<the curated intent — the synthesized statement of what this space (or cut) intends>"}`,
    linkItems:
      `{"type":"linkItems","actor":"${actor}","itemId":"${exampleItemId}","requires":["<itemId this item depends on>"]}` +
      ` — declare an edge ONLY where this item's meaning genuinely depends on the other (a constraint governing an element, ` +
      `a criterion judging it, a gap questioning it). Never link merely-related items`,
    addObjection: `{"type":"addObjection","text":"<the objection>"}`,
    addItem: `{"type":"addItem","actor":"human","sectionId":"${exampleSectionId}","text":"<the item text>","modality":"optional"}`,
    checkItem: `{"type":"checkItem","actor":"human","itemId":"${exampleItemId}"}`,
    uncheckItem: `{"type":"uncheckItem","actor":"human","itemId":"${exampleItemId}"}`,
    editItemText: `{"type":"editItemText","actor":"human","itemId":"${exampleItemId}","text":"<replacement text>"}`,
    setModality: `{"type":"setModality","actor":"human","itemId":"${exampleItemId}","modality":"mandatory"}`,
    setEval: `{"type":"setEval","actor":"human","itemId":"${exampleItemId}","facet":"risk","value":2}`,
    deferItem: `{"type":"deferItem","actor":"human","itemId":"${exampleItemId}"}`,
    resolveItem: `{"type":"resolveItem","actor":"human","itemId":"${exampleItemId}"}` +
      ` — closes an ANSWERED question (gap item): visible record, no longer open`,
    dropItem: `{"type":"dropItem","actor":"human","itemId":"${exampleItemId}"}`,
    supersedeItem: `{"type":"supersedeItem","actor":"human","itemId":"${exampleItemId}","supersedes":"<itemId being superseded>"}`,
    resolveEdit: `{"type":"resolveEdit","actor":"human","itemId":"${exampleItemId}","accept":true}`,
  };

  lines.push(
    "",
    "Exact shape for each action you are allowed to emit (copy the shape, replace only the values):",
  );
  for (const tool of allowed) {
    const shape = shapes[tool];
    if (shape) lines.push(`- ${tool} → ${shape}`);
  }

  lines.push(
    "",
    "Rules:",
    "- Use ONLY the sectionId/itemId values listed above. Never invent an ID; never use a section's display name in place of its sectionId.",
    `- You may emit ONLY these action types: ${allowed.join(", ") || "(none)"}. Anything else is rejected.`,
  );

  return lines.join("\n");
}

// ── normalizeWorkerActions ───────────────────────────────────────────────────

/**
 * Validate + coerce raw parsed worker actions against the live model and the
 * worker's gate. Salvages common shape drift; everything unsalvageable lands
 * in `rejected` with a human-readable reason instead of reaching the reducer.
 */
export function normalizeWorkerActions(
  rawActions: unknown[],
  model: WorkingModel,
  opts: NormalizeOptions,
): NormalizeResult {
  const valid: Action[] = [];
  const rejected: RejectedAction[] = [];
  const gate = new Set<string>(opts.allowedTools);

  // Batch-aware id prediction for intra-batch dependency edges: the reducer's
  // id scheme is deterministic (item-<sectionId>-<count>), so an item proposed
  // EARLIER in this same batch has a knowable id (the same prediction
  // research.run uses for its evidence chips).
  const sectionCounts = new Map<string, number>();
  for (const sec of model.sections) sectionCounts.set(sec.id, sec.items.length);
  const batchTextToId = new Map<string, string>();
  const batchIds = new Set<string>();

  // Duplicate wall (2026-07-17: per-entry expansion rounds piled up
  // near-identical items): normalized text of every existing + this-batch
  // item; duplicate proposals are rejected with a reason.
  const normText = (t: string): string =>
    t.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/g, "").trim();
  const knownTexts = new Set<string>();
  for (const sec of model.sections)
    for (const it of sec.items)
      if (it.state !== "dropped") knownTexts.add(normText(it.text));

  /** Resolve one `requires` reference: existing id → in-batch predicted id →
   *  existing item exact text → earlier-in-batch proposed text. Null if none. */
  const resolveRequiresRef = (ref: string): string | null => {
    for (const sec of model.sections) {
      for (const it of sec.items) {
        if (it.id === ref) return ref;
      }
    }
    if (batchIds.has(ref)) return ref;
    const key = ref.trim().toLowerCase();
    for (const sec of model.sections) {
      for (const it of sec.items) {
        if (it.text.trim().toLowerCase() === key) return it.id;
      }
    }
    return batchTextToId.get(key) ?? null;
  };

  for (const raw of rawActions) {
    const rec = asRecord(raw);
    if (rec === null) {
      rejected.push({ raw, reason: "action is not a JSON object" });
      continue;
    }
    const type = asNonEmptyString(rec.type ?? rec.tool ?? rec.name);
    if (type === null) {
      rejected.push({ raw, reason: "action carries no type" });
      continue;
    }
    if (!EMITTABLE.has(type)) {
      rejected.push({ raw, reason: `unknown action type '${type}'` });
      continue;
    }
    if (!gate.has(type)) {
      rejected.push({
        raw,
        reason: `'${type}' is outside this worker's gate`,
      });
      continue;
    }

    switch (type) {
      case "proposeItem": {
        const sectionId = resolveSectionId(
          model,
          rec.sectionId ?? rec.section ?? rec.sectionKind,
        );
        if (sectionId === null) {
          rejected.push({
            raw,
            reason: `proposeItem targets an unknown section (${JSON.stringify(
              rec.sectionId ?? rec.section ?? rec.sectionKind ?? null,
            )})`,
          });
          continue;
        }
        if (sectionKindOf(model, sectionId) === "goal") {
          rejected.push({
            raw,
            reason: "items cannot be proposed on the goal section",
          });
          continue;
        }
        const itemRec = asRecord(rec.item);
        const text = asNonEmptyString(itemRec?.text ?? rec.text);
        if (text === null) {
          rejected.push({ raw, reason: "proposeItem carries no item text" });
          continue;
        }
        if (knownTexts.has(normText(text))) {
          rejected.push({
            raw,
            reason: `duplicate proposal dropped — an item with this text already exists: "${text.slice(0, 60)}"`,
          });
          continue;
        }
        knownTexts.add(normText(text));
        const evalsRec = asRecord(itemRec?.evals ?? rec.evals) ?? {};
        const evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 } = {};
        const complexity = asEvalValue(evalsRec.complexity);
        const risk = asEvalValue(evalsRec.risk);
        if (complexity !== undefined) evals.complexity = complexity;
        if (risk !== undefined) evals.risk = risk;
        const item: {
          text: string;
          modality: Modality;
          evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
          note?: string;
          requires?: string[];
          factors?: { complexity?: ComplexityFactor; risk?: RiskFactor };
        } = {
          text,
          modality: asModality(itemRec?.modality ?? rec.modality),
          evals,
        };
        const note = asNonEmptyString(itemRec?.note ?? rec.note);
        if (note !== null) item.note = note;

        // Factors: validated against the closed vocabularies; an invalid
        // factor is dropped (score kept — it just stays unexplained).
        const factorsRec = asRecord(itemRec?.factors ?? rec.factors);
        if (factorsRec !== null) {
          const factors: {
            complexity?: ComplexityFactor;
            risk?: RiskFactor;
          } = {};
          if (
            COMPLEXITY_FACTORS.includes(
              factorsRec.complexity as ComplexityFactor,
            )
          ) {
            factors.complexity = factorsRec.complexity as ComplexityFactor;
          }
          if (RISK_FACTORS.includes(factorsRec.risk as RiskFactor)) {
            factors.risk = factorsRec.risk as RiskFactor;
          }
          if (factors.complexity !== undefined || factors.risk !== undefined) {
            item.factors = factors;
          }
        }

        // Predict this item's id BEFORE resolving its edges, so a later item
        // in the same batch can reference this one (and self-edges resolve
        // to the predicted id and are dropped below).
        const predictedId = `item-${sectionId}-${sectionCounts.get(sectionId) ?? 0}`;
        sectionCounts.set(sectionId, (sectionCounts.get(sectionId) ?? 0) + 1);
        batchTextToId.set(text.trim().toLowerCase(), predictedId);
        batchIds.add(predictedId);

        const rawRequires = itemRec?.requires ?? rec.requires;
        if (Array.isArray(rawRequires)) {
          const resolved: string[] = [];
          for (const ref of rawRequires) {
            const r = asNonEmptyString(ref);
            if (r === null) continue;
            const id = resolveRequiresRef(r);
            if (id === null) {
              rejected.push({
                raw: ref,
                reason: `unresolvable requires reference ${JSON.stringify(r)} — edge dropped, item kept`,
              });
            } else if (id !== predictedId) {
              resolved.push(id);
            }
          }
          if (resolved.length > 0) item.requires = [...new Set(resolved)];
        }

        valid.push({
          type: "proposeItem",
          actor: asWorkerActor(rec.actor, opts.defaultActor),
          sectionId,
          item,
        });
        continue;
      }

      case "proposeEdit": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({
            raw,
            reason: "proposeEdit targets an unknown item",
          });
          continue;
        }
        const newText = asNonEmptyString(rec.newText ?? rec.text);
        if (newText === null) {
          rejected.push({ raw, reason: "proposeEdit carries no newText" });
          continue;
        }
        valid.push({
          type: "proposeEdit",
          actor: asWorkerActor(rec.actor, opts.defaultActor),
          itemId,
          newText,
        });
        continue;
      }

      case "addItemNote": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({
            raw,
            reason: "addItemNote targets an unknown item",
          });
          continue;
        }
        const text = asNonEmptyString(rec.text ?? rec.note);
        if (text === null) {
          rejected.push({ raw, reason: "addItemNote carries no text" });
          continue;
        }
        // The Action type declares addItemNote actor as "human", yet the
        // gap-filler/integrator/research gates all grant addItemNote — a
        // type/gate drift (ledgered). The reducer ignores the actor for notes;
        // we keep the true round actor for honest provenance and cast.
        valid.push({
          type: "addItemNote",
          actor:
            opts.defaultActor === "human"
              ? "human"
              : asWorkerActor(rec.actor, opts.defaultActor),
          itemId,
          text,
        } as unknown as Action);
        continue;
      }

      case "attachEvidence": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({
            raw,
            reason: "attachEvidence targets an unknown item",
          });
          continue;
        }
        const evRec = asRecord(rec.evidence) ?? rec;
        const source = asNonEmptyString(evRec.source);
        const method = asNonEmptyString(evRec.method);
        if (source === null || method === null) {
          rejected.push({
            raw,
            reason: "attachEvidence needs evidence.source and evidence.method",
          });
          continue;
        }
        const checkedAt = asNonEmptyString(evRec.checkedAt) ?? opts.nowIso;
        if (checkedAt === undefined) {
          rejected.push({
            raw,
            reason: "attachEvidence carries no checkedAt (and no round timestamp available)",
          });
          continue;
        }
        const evidence: Evidence = { source, method, checkedAt };
        const dossierRef = asNonEmptyString(evRec.dossierRef);
        if (dossierRef !== null) evidence.dossierRef = dossierRef;
        valid.push({
          type: "attachEvidence",
          actor: asWorkerActor(rec.actor, opts.defaultActor),
          itemId,
          evidence,
        });
        continue;
      }

      case "editGoal": {
        if (typeof rec.text !== "string") {
          rejected.push({ raw, reason: "editGoal carries no text" });
          continue;
        }
        // Empty text is passed through — the reducer's erasure guard owns that
        // invariant (empty rewrite over a non-empty intent is rejected there).
        valid.push({ type: "editGoal", text: rec.text });
        continue;
      }

      case "curateIntent": {
        if (typeof rec.text !== "string") {
          rejected.push({ raw, reason: "curateIntent carries no text" });
          continue;
        }
        // Erasure guard lives in the reducer (empty over non-empty rejected).
        const curate: Action = { type: "curateIntent", text: rec.text };
        const title = asNonEmptyString(rec.title);
        if (title !== null) {
          (curate as { title?: string }).title = title.slice(0, 80);
        }
        valid.push(curate);
        continue;
      }

      case "linkItems": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({ raw, reason: "linkItems targets an unknown item" });
          continue;
        }
        const rawReqs = rec.requires ?? rec.dependsOn ?? rec.links;
        const resolved: string[] = [];
        if (Array.isArray(rawReqs)) {
          for (const ref of rawReqs) {
            const r = asNonEmptyString(ref);
            if (r === null) continue;
            const id = resolveRequiresRef(r);
            if (id !== null && id !== itemId) resolved.push(id);
          }
        }
        if (resolved.length === 0) {
          rejected.push({
            raw,
            reason: "linkItems resolved no valid edges",
          });
          continue;
        }
        valid.push({
          type: "linkItems",
          actor:
            opts.defaultActor === "human"
              ? "human"
              : asWorkerActor(rec.actor, opts.defaultActor),
          itemId,
          requires: [...new Set(resolved)],
        });
        continue;
      }

      case "addObjection": {
        const text = asNonEmptyString(rec.text);
        if (text === null) {
          rejected.push({ raw, reason: "addObjection carries no text" });
          continue;
        }
        valid.push({ type: "addObjection", text });
        continue;
      }

      // ── Human vocabulary (the command-field interpreter) ─────────────────
      // Every action below is stamped actor:"human" unconditionally: the
      // utterance is the human's act, whatever actor the model emitted.

      case "addItem": {
        const sectionId = resolveSectionId(
          model,
          rec.sectionId ?? rec.section ?? rec.sectionKind,
        );
        if (sectionId === null || sectionKindOf(model, sectionId) === "goal") {
          rejected.push({
            raw,
            reason: "addItem targets an unknown (or goal) section",
          });
          continue;
        }
        const text = asNonEmptyString(rec.text ?? asRecord(rec.item)?.text);
        if (text === null) {
          rejected.push({ raw, reason: "addItem carries no text" });
          continue;
        }
        const action: Action = {
          type: "addItem",
          actor: "human",
          sectionId,
          text,
        };
        if (rec.modality === "mandatory" || rec.modality === "optional") {
          action.modality = rec.modality;
        }
        valid.push(action);
        continue;
      }

      case "checkItem":
      case "uncheckItem":
      case "deferItem":
      case "resolveItem":
      case "dropItem": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null) {
          rejected.push({ raw, reason: `${type} targets an unknown item` });
          continue;
        }
        valid.push({ type, actor: "human", itemId } as Action);
        continue;
      }

      case "editItemText": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        const text = asNonEmptyString(rec.text ?? rec.newText);
        if (itemId === null || text === null) {
          rejected.push({
            raw,
            reason: "editItemText needs a known itemId and non-empty text",
          });
          continue;
        }
        valid.push({ type: "editItemText", actor: "human", itemId, text });
        continue;
      }

      case "setModality": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (
          itemId === null ||
          (rec.modality !== "mandatory" && rec.modality !== "optional")
        ) {
          rejected.push({
            raw,
            reason:
              'setModality needs a known itemId and modality "mandatory"|"optional"',
          });
          continue;
        }
        valid.push({
          type: "setModality",
          actor: "human",
          itemId,
          modality: rec.modality,
        });
        continue;
      }

      case "setEval": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        const facet =
          rec.facet === "complexity" || rec.facet === "risk"
            ? rec.facet
            : null;
        const value = asEvalValue(rec.value);
        if (itemId === null || facet === null || value === undefined) {
          rejected.push({
            raw,
            reason:
              "setEval needs a known itemId, facet complexity|risk, and value 1|2|3",
          });
          continue;
        }
        valid.push({ type: "setEval", actor: "human", itemId, facet, value });
        continue;
      }

      case "supersedeItem": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        const supersedes = resolveItemId(model, rec.supersedes);
        if (itemId === null || supersedes === null) {
          rejected.push({
            raw,
            reason:
              "supersedeItem needs known itemId and supersedes item ids",
          });
          continue;
        }
        valid.push({ type: "supersedeItem", actor: "human", itemId, supersedes });
        continue;
      }

      case "resolveEdit": {
        const itemId = resolveItemId(model, rec.itemId ?? rec.id ?? rec.item);
        if (itemId === null || typeof rec.accept !== "boolean") {
          rejected.push({
            raw,
            reason: "resolveEdit needs a known itemId and a boolean accept",
          });
          continue;
        }
        valid.push({
          type: "resolveEdit",
          actor: "human",
          itemId,
          accept: rec.accept,
        });
        continue;
      }
    }
  }

  return { valid, rejected };
}
