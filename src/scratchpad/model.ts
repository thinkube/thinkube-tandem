// ===== Shared working model =====

export type Tenant = "tep" | "spec";
export type Phase = "drafting" | "shaping" | "reframing" | "ready";
export type SectionKind =
  "goal" | "constraints" | "elements" | "gap" | "criteria" | "verification";
export type SectionState = "empty" | "proposed" | "shaping" | "settled";
export type Coverage = "unknown" | "assumed" | "verified";

// ── SP-21/3 item model ──

export type Modality = "mandatory" | "optional";

// ── Eval factor vocabularies (2026-07-16) ──
// A score is only explainable if it names WHICH factor produced it. Closed
// vocabularies keep scores challengeable and aggregatable (methodology review
// can cluster on factors; free text cannot).
export type ComplexityFactor =
  | "interactions" // entangled with several other items/sections
  | "novelty" // uncharted territory — nothing known covers it
  | "ambiguity" // several plausible readings; needs shaping
  | "decomposition" // resists being cut into clean parts
  | "external-coupling"; // depends on behavior outside our control
export type RiskFactor =
  | "irreversible" // a wrong call cannot be cheaply undone
  | "blast-radius" // many items depend on this one
  | "unverified-assumption" // load-bearing claim with no evidence
  | "external-dependency" // relies on undocumented/uncontrolled behavior
  | "integrity" // consequence class: security, data-loss, signed artifacts
  | "hack-debt"; // a known shortcut whose debt is being accepted

export const COMPLEXITY_FACTORS: readonly ComplexityFactor[] = [
  "interactions",
  "novelty",
  "ambiguity",
  "decomposition",
  "external-coupling",
];
export const RISK_FACTORS: readonly RiskFactor[] = [
  "irreversible",
  "blast-radius",
  "unverified-assumption",
  "external-dependency",
  "integrity",
  "hack-debt",
];
export type ItemState =
  | "active"
  | "shipped"
  | "deferred"
  | "dropped"
  // 2026-07-17: a gap item whose question has been ANSWERED (typically after
  // research). Stays visible as record; excluded from coverage pressure,
  // projection, reframe, and cuts. The closure gesture gaps never had.
  | "resolved";
export type ItemOrigin = "human" | "gap-filler" | "integrator" | "research";
export type Actor = ItemOrigin | "interpreter";

export interface Evidence {
  source: string;
  method: string;
  checkedAt: string; // ISO string from deps.now()
  dossierRef?: string;
}

export interface PendingEdit {
  oldText: string;
  newText: string;
  origin: ItemOrigin;
}

export interface Item {
  id: string;
  text: string;
  checked: boolean;
  modality: Modality;
  evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
  /** WHICH factor produced each score — makes the eval explainable and
   *  challengeable. Dropped for a facet when the human overrides its score
   *  (the old justification no longer applies). */
  evalFactors?: { complexity?: ComplexityFactor; risk?: RiskFactor };
  /**
   * TEPs this item served as CONTEXT for (cut flags, 2026-07-16). A flagged
   * item is protected — immutable, undroppable, uneditable; supersede is the
   * only evolution path — but stays ACTIVE and keeps serving future cuts.
   * (Elements consumed by a cut ship instead: state:"shipped" + shippedIn.)
   */
  flaggedBy?: string[];
  origin: ItemOrigin;
  state: ItemState;
  shippedIn?: string; // TEP id when state === "shipped"
  supersedes?: string;
  supersededBy?: string;
  /**
   * Dependency edges: ids of items THIS item requires (2026-07-16). Modality
   * and rationale are set-relative — an item can be mandatory only because a
   * dependency survives — so the relation is a first-class field, never
   * prose. Items are never deleted (drop/defer flip state), so edges always
   * resolve; a dropped/deferred dependency marks the dependent's rationale
   * stale (derived at render, not stored).
   */
  requires?: string[];
  evidence: Evidence[];
  notes: Note[];
  pendingEdit?: PendingEdit;
}

export type ToolName =
  | "editGoal"
  | "editSection"
  | "proposeSection"
  | "addNote"
  | "addObjection"
  | "setSectionState"
  | "freeze"
  | "writeArtifact"
  // SP-21/3 item tool names
  | "proposeItem"
  | "addItem"
  | "checkItem"
  | "uncheckItem"
  | "editItemText"
  | "setModality"
  | "setEval"
  | "deferItem"
  | "dropItem"
  | "supersedeItem"
  | "proposeEdit"
  | "resolveEdit"
  | "addItemNote"
  | "attachEvidence"
  | "stampShipped"
  // 2026-07-16 redesign: the reframe worker maintains the CURATED intent —
  // it never again edits the human's goal/rough words.
  | "curateIntent"
  // 2026-07-17: dependency edges on EXISTING items (pre-edge spaces have
  // none, so cuts pulled zero context) — the linker round's only tool.
  | "linkItems"
  // 2026-07-17: close an answered gap (human settling gesture).
  | "resolveItem";

export interface Note {
  id: string;
  text: string;
  /** Who wrote it — "human", "gap-filler", "integrator", "research"
   *  (2026-07-16: notes rendered with no provenance; unattributed prose on a
   *  decision surface is unreviewable). Absent on pre-existing notes. */
  by?: string;
}

export interface Proposal {
  id: string;
  workerId: string;
  kind: SectionKind;
  text: string;
}

export interface Objection {
  id: string;
  text: string;
  resolved: boolean;
}

export interface Section {
  id: string;
  kind: SectionKind;
  text: string;
  state: SectionState;
  coverage: Coverage;
  notes: Note[];
  proposals: Proposal[];
  items: Item[]; // SP-21/3: checklist items for this section
}

export interface ReadinessRecord {
  covered: boolean;
  cleanCut: boolean;
  gapSection: SectionKind | null;
  /** The judge's own explanation of what is missing or ambiguous — carried
   *  verbatim so the surface can say WHY, not just where (2026-07-16: a bare
   *  section kind produced "found a gap in 'gap'"). */
  note?: string;
}

export interface WorkingModel {
  tenant: Tenant;
  phase: Phase;
  sections: Section[];
  objections: Objection[];
  readinessHistory: ReadinessRecord[];
  /**
   * Append-only journal of the human's raw asks (2026-07-16 redesign): the
   * space accepts new rough requests for its whole life; each expands the
   * space. Entries are NEVER edited or removed — human words are the record.
   * Absent on pre-redesign spaces (treated as []).
   */
  roughRequests?: RoughRequest[];
  /**
   * The curated intent: the synthesized statement of what the space (or the
   * active cut) currently intends — maintained by the reframe worker, never
   * touching the human's rough words. This is what freeze signs as the TEP's
   * intent (falling back to the goal text when absent).
   */
  curatedIntent?: string;
  /** Crisp TEP title (≤80 chars), synthesized alongside the curated intent.
   *  Projections fall back to a clipped first line when absent. */
  curatedTitle?: string;
}

export interface RoughRequest {
  id: string;
  text: string;
}

export type Action =
  // ── SP-1 actions ──
  | { type: "seedGoal"; text: string }
  | { type: "editGoal"; text: string }
  | {
      type: "proposeSection";
      kind: SectionKind;
      text: string;
      workerId: string;
    }
  | { type: "editSection"; id: string; text: string }
  | { type: "setSectionState"; id: string; state: SectionState }
  | { type: "addNote"; sectionId: string; text: string }
  | { type: "addObjection"; text: string }
  | { type: "resolveObjection"; id: string }
  | { type: "setPhase"; phase: Phase }
  | { type: "recordReadiness"; record: ReadinessRecord }
  // ── SP-21/3 item actions ──
  | {
      type: "proposeItem";
      actor: Exclude<Actor, "human">;
      sectionId: string;
      item: {
        text: string;
        modality: Modality;
        evals: { complexity?: 1 | 2 | 3; risk?: 1 | 2 | 3 };
        /** Optional Why/Impact/Modality explanation, attached as the item's
         *  first note at creation (2026-07-16: proposals should arrive with
         *  their rationale — deciding on a bare one-liner is guesswork). */
        note?: string;
        /** Optional dependency edges (item ids this item requires). The
         *  normalize seam resolves text references — including items proposed
         *  earlier in the same batch — to ids before dispatch. */
        requires?: string[];
        /** WHICH factor produced each eval score (closed vocabularies). */
        factors?: { complexity?: ComplexityFactor; risk?: RiskFactor };
      };
    }
  | {
      type: "addItem";
      actor: "human";
      sectionId: string;
      text: string;
      modality?: Modality;
    }
  | { type: "checkItem"; actor: Actor; itemId: string }
  | { type: "uncheckItem"; actor: Actor; itemId: string }
  | { type: "editItemText"; actor: "human"; itemId: string; text: string }
  | { type: "setModality"; actor: "human"; itemId: string; modality: Modality }
  | {
      type: "setEval";
      actor: "human";
      itemId: string;
      facet: "complexity" | "risk";
      value: 1 | 2 | 3;
    }
  | { type: "deferItem"; actor: "human"; itemId: string }
  // 2026-07-17: mark an answered question resolved — visible record, no
  // longer open. State transition only (allowed even on flagged items).
  | { type: "resolveItem"; actor: "human"; itemId: string }
  | { type: "dropItem"; actor: "human"; itemId: string }
  | { type: "supersedeItem"; actor: Actor; itemId: string; supersedes: string }
  | {
      type: "proposeEdit";
      actor: Exclude<Actor, "human">;
      itemId: string;
      newText: string;
    }
  | { type: "resolveEdit"; actor: "human"; itemId: string; accept: boolean }
  | { type: "addItemNote"; actor: "human"; itemId: string; text: string }
  // Human-only: workers may never destroy an annotation (2026-07-16 — needed
  // to clean duplicate/contradictory explainer notes).
  | { type: "removeNote"; actor: "human"; itemId: string; noteId: string }
  | { type: "attachEvidence"; actor: Actor; itemId: string; evidence: Evidence }
  | {
      type: "stampShipped";
      itemIds: string[];
      tepId: string;
      /** Context items the cut drew on: flagged with the TEP (protected,
       *  still active for future cuts) instead of shipped. */
      flagIds?: string[];
    }
  // ── 2026-07-16 redesign actions ──
  | { type: "addRoughRequest"; text: string } // human-only, append-only
  | { type: "curateIntent"; text: string; title?: string } // reframe worker (or human edit)
  // 2026-07-17: add dependency edges to an EXISTING item (merge-unique).
  // Structural metadata for future cuts — allowed even on protected items
  // (it never alters their recorded content).
  | { type: "linkItems"; actor: Actor; itemId: string; requires: string[] };

/**
 * Delta describing a model mutation.
 *
 * "applied" — the action was applied and the named field was changed.
 * "rejected" — the action was rejected by a reducer invariant; the model is
 *              UNCHANGED (same reference as the input).
 */
export type Delta =
  | {
      kind: "applied";
      action: Action;
      field: string;
      before: unknown;
      after: unknown;
    }
  | { kind: "rejected"; action: Action; reason: string };

// ── Internal helpers ──

interface ItemLocation {
  sectionIdx: number;
  itemIdx: number;
}

function findItem(
  model: WorkingModel,
  itemId: string,
): ItemLocation | undefined {
  for (let si = 0; si < model.sections.length; si++) {
    const section = model.sections[si];
    for (let ii = 0; ii < section.items.length; ii++) {
      if (section.items[ii].id === itemId) {
        return { sectionIdx: si, itemIdx: ii };
      }
    }
  }
  return undefined;
}

function updateItemInModel(
  model: WorkingModel,
  sectionIdx: number,
  itemIdx: number,
  updater: (item: Item) => Item,
): WorkingModel {
  const section = model.sections[sectionIdx];
  const newItems = [...section.items];
  newItems[itemIdx] = updater(newItems[itemIdx]);
  const newSection: Section = { ...section, items: newItems };
  const newSections = [...model.sections];
  newSections[sectionIdx] = newSection;
  return { ...model, sections: newSections };
}

/**
 * Create an empty working model seeded with exactly one empty-items section
 * per kind: goal, constraints, elements, gap, criteria, verification.
 */
export function emptyModel(tenant: Tenant): WorkingModel {
  const kinds: SectionKind[] = [
    "goal",
    "constraints",
    "elements",
    "gap",
    "criteria",
    "verification",
  ];
  const sections: Section[] = kinds.map((kind, idx) => ({
    id: `sec-${idx}`,
    kind,
    text: "",
    state: "empty" as SectionState,
    coverage: "unknown" as Coverage,
    notes: [],
    proposals: [],
    items: [],
  }));
  return {
    tenant,
    phase: "drafting",
    sections,
    objections: [],
    readinessHistory: [],
  };
}

/** Return the kind:'goal' section from the model. Throws if missing. */
export function goalSection(model: WorkingModel): Section {
  const s = model.sections.find((sec) => sec.kind === "goal");
  if (!s) {
    throw new Error("No goal section found in working model");
  }
  return s;
}

/**
 * Pure reducer — returns a new model plus an explicit delta.
 *
 * INVARIANT (reducer-enforced): any checked-affecting action
 * (checkItem / uncheckItem / addItem) whose actor !== "human" returns the
 * SAME model reference (unchanged) and a { kind:"rejected" } delta.
 *
 * stampShipped is EXEMPT from that rule (it never mutates checked).
 *
 * Never mutates the input model.
 */

/**
 * True when the item is TEP-protected (2026-07-16): shipped by a cut, or
 * flagged as context a signed TEP was cut under. Protected items are
 * immutable — no edit, no reclassification, no drop; supersede is the only
 * evolution path. Checking/unchecking stays allowed on flagged (active)
 * items: settling for a FUTURE cut does not rewrite the record.
 */
export function isProtected(item: Item): boolean {
  return item.state === "shipped" || (item.flaggedBy?.length ?? 0) > 0;
}

export function reduce(
  model: WorkingModel,
  action: Action,
): { model: WorkingModel; delta: Delta } {
  switch (action.type) {
    // ── SP-1 actions ─────────────────────────────────────────────────────────

    case "seedGoal": {
      const goalIdx = model.sections.findIndex((s) => s.kind === "goal");
      if (goalIdx === -1) throw new Error("No goal section");
      const goal = model.sections[goalIdx];
      const before = goal.text;
      const newGoal: Section = { ...goal, text: action.text };
      const newSections = [...model.sections];
      newSections[goalIdx] = newGoal;
      return {
        model: { ...model, phase: "shaping", sections: newSections },
        delta: {
          kind: "applied",
          action,
          field: "goal.text",
          before,
          after: action.text,
        },
      };
    }

    case "editGoal": {
      const goalIdx = model.sections.findIndex((s) => s.kind === "goal");
      if (goalIdx === -1) throw new Error("No goal section");
      const goal = model.sections[goalIdx];
      const before = goal.text;
      // Erasure guard (2026-07-16, field defect): an EMPTY rewrite never
      // overwrites a non-empty intent — a blank worker output is a failed
      // round, not a new goal. Applies to every actor; clearing on purpose
      // is not a gesture the surface offers.
      if (!action.text.trim() && before.trim()) {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason:
              "empty rewrite refused — it would erase a non-empty intent",
          },
        };
      }
      const newGoal: Section = { ...goal, text: action.text };
      const newSections = [...model.sections];
      newSections[goalIdx] = newGoal;
      return {
        model: { ...model, sections: newSections },
        delta: {
          kind: "applied",
          action,
          field: "goal.text",
          before,
          after: action.text,
        },
      };
    }

    case "proposeSection": {
      const sectionIdx = model.sections.length;
      const newSection: Section = {
        id: `sec-${sectionIdx}`,
        kind: action.kind,
        text: action.text,
        state: "proposed",
        coverage: "unknown",
        notes: [],
        proposals: [
          {
            id: `prop-${sectionIdx}-0`,
            workerId: action.workerId,
            kind: action.kind,
            text: action.text,
          },
        ],
        items: [],
      };
      return {
        model: { ...model, sections: [...model.sections, newSection] },
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}`,
          before: undefined,
          after: newSection,
        },
      };
    }

    case "editSection": {
      const idx = model.sections.findIndex((s) => s.id === action.id);
      if (idx === -1) throw new Error(`Section '${action.id}' not found`);
      const section = model.sections[idx];
      const before = section.text;
      const newSection: Section = { ...section, text: action.text };
      const newSections = [...model.sections];
      newSections[idx] = newSection;
      return {
        model: { ...model, sections: newSections },
        delta: {
          kind: "applied",
          action,
          field: `sections.${idx}.text`,
          before,
          after: action.text,
        },
      };
    }

    case "setSectionState": {
      const idx = model.sections.findIndex((s) => s.id === action.id);
      if (idx === -1) throw new Error(`Section '${action.id}' not found`);
      const section = model.sections[idx];
      const before = section.state;
      const newSection: Section = { ...section, state: action.state };
      const newSections = [...model.sections];
      newSections[idx] = newSection;
      return {
        model: { ...model, sections: newSections },
        delta: {
          kind: "applied",
          action,
          field: `sections.${idx}.state`,
          before,
          after: action.state,
        },
      };
    }

    case "addNote": {
      const idx = model.sections.findIndex((s) => s.id === action.sectionId);
      if (idx === -1)
        throw new Error(`Section '${action.sectionId}' not found`);
      const section = model.sections[idx];
      const noteIdx = section.notes.length;
      const note: Note = {
        id: `note-${section.id}-${noteIdx}`,
        text: action.text,
      };
      const newSection: Section = {
        ...section,
        notes: [...section.notes, note],
      };
      const newSections = [...model.sections];
      newSections[idx] = newSection;
      return {
        model: { ...model, sections: newSections },
        delta: {
          kind: "applied",
          action,
          field: `sections.${idx}.notes.${noteIdx}`,
          before: undefined,
          after: note,
        },
      };
    }

    case "addObjection": {
      const objIdx = model.objections.length;
      const objection: Objection = {
        id: `obj-${objIdx}`,
        text: action.text,
        resolved: false,
      };
      return {
        model: { ...model, objections: [...model.objections, objection] },
        delta: {
          kind: "applied",
          action,
          field: `objections.${objIdx}`,
          before: undefined,
          after: objection,
        },
      };
    }

    case "resolveObjection": {
      const idx = model.objections.findIndex((o) => o.id === action.id);
      if (idx === -1) throw new Error(`Objection '${action.id}' not found`);
      const objection = model.objections[idx];
      const before = objection.resolved;
      const newObjection: Objection = { ...objection, resolved: true };
      const newObjections = [...model.objections];
      newObjections[idx] = newObjection;
      return {
        model: { ...model, objections: newObjections },
        delta: {
          kind: "applied",
          action,
          field: `objections.${idx}.resolved`,
          before,
          after: true,
        },
      };
    }

    case "setPhase": {
      const before = model.phase;
      return {
        model: { ...model, phase: action.phase },
        delta: {
          kind: "applied",
          action,
          field: "phase",
          before,
          after: action.phase,
        },
      };
    }

    case "recordReadiness": {
      const histIdx = model.readinessHistory.length;
      return {
        model: {
          ...model,
          readinessHistory: [...model.readinessHistory, action.record],
        },
        delta: {
          kind: "applied",
          action,
          field: `readinessHistory.${histIdx}`,
          before: undefined,
          after: action.record,
        },
      };
    }

    // ── SP-21/3 item actions ─────────────────────────────────────────────────

    case "proposeItem": {
      const idx = model.sections.findIndex((s) => s.id === action.sectionId);
      if (idx === -1)
        throw new Error(`Section '${action.sectionId}' not found`);
      const section = model.sections[idx];
      const itemIdx = section.items.length;
      const newItemId = `item-${action.sectionId}-${itemIdx}`;
      const initialNotes: Note[] =
        action.item.note !== undefined && action.item.note.trim()
          ? [
              {
                id: `note-${newItemId}-0`,
                text: action.item.note.trim(),
                by: action.actor,
              },
            ]
          : [];
      const newItem: Item = {
        id: newItemId,
        text: action.item.text,
        checked: false,
        modality: action.item.modality,
        evals: { ...action.item.evals },
        origin: action.actor as ItemOrigin,
        state: "active",
        evidence: [],
        notes: initialNotes,
      };
      if (action.item.requires !== undefined && action.item.requires.length) {
        newItem.requires = [...action.item.requires];
      }
      if (
        action.item.factors !== undefined &&
        (action.item.factors.complexity !== undefined ||
          action.item.factors.risk !== undefined)
      ) {
        newItem.evalFactors = { ...action.item.factors };
      }
      const newSection: Section = {
        ...section,
        items: [...section.items, newItem],
      };
      const newSections = [...model.sections];
      newSections[idx] = newSection;
      return {
        model: { ...model, sections: newSections },
        delta: {
          kind: "applied",
          action,
          field: `sections.${idx}.items.${itemIdx}`,
          before: undefined,
          after: newItem,
        },
      };
    }

    case "addItem": {
      // INVARIANT: addItem produces checked:true — actor must be "human" at runtime
      const actorRuntime: string = action.actor;
      if (actorRuntime !== "human") {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason:
              "addItem: only human actor can produce a checked item (invariant)",
          },
        };
      }
      const idx = model.sections.findIndex((s) => s.id === action.sectionId);
      if (idx === -1)
        throw new Error(`Section '${action.sectionId}' not found`);
      const section = model.sections[idx];
      const itemIdx = section.items.length;
      const newItem: Item = {
        id: `item-${action.sectionId}-${itemIdx}`,
        text: action.text,
        checked: true,
        modality: action.modality ?? "mandatory",
        evals: {},
        origin: "human",
        state: "active",
        evidence: [],
        notes: [],
      };
      const newSection: Section = {
        ...section,
        items: [...section.items, newItem],
      };
      const newSections = [...model.sections];
      newSections[idx] = newSection;
      return {
        model: { ...model, sections: newSections },
        delta: {
          kind: "applied",
          action,
          field: `sections.${idx}.items.${itemIdx}`,
          before: undefined,
          after: newItem,
        },
      };
    }

    case "checkItem": {
      // INVARIANT: only human actor may set checked=true
      if (action.actor !== "human") {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason: "checkItem: only human actor can check an item (invariant)",
          },
        };
      }
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const before = model.sections[sectionIdx].items[itemIdx].checked;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        checked: true,
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.checked`,
          before,
          after: true,
        },
      };
    }

    case "uncheckItem": {
      // INVARIANT: only human actor may set checked=false
      if (action.actor !== "human") {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason:
              "uncheckItem: only human actor can uncheck an item (invariant)",
          },
        };
      }
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const before = model.sections[sectionIdx].items[itemIdx].checked;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        checked: false,
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.checked`,
          before,
          after: false,
        },
      };
    }

    case "editItemText": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      {
        const { sectionIdx: gsi, itemIdx: gii } = loc;
        const target = model.sections[gsi].items[gii];
        if (isProtected(target)) {
          return {
            model,
            delta: {
              kind: "rejected",
              action,
              reason:
                "item is TEP-protected (shipped or flagged as signed context) — immutable; supersede it instead",
            },
          };
        }
      }
      const { sectionIdx, itemIdx } = loc;
      const before = model.sections[sectionIdx].items[itemIdx].text;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        text: action.text,
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.text`,
          before,
          after: action.text,
        },
      };
    }

    case "setModality": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      {
        const { sectionIdx: gsi, itemIdx: gii } = loc;
        const target = model.sections[gsi].items[gii];
        if (isProtected(target)) {
          return {
            model,
            delta: {
              kind: "rejected",
              action,
              reason:
                "item is TEP-protected (shipped or flagged as signed context) — immutable; supersede it instead",
            },
          };
        }
      }
      const { sectionIdx, itemIdx } = loc;
      const before = model.sections[sectionIdx].items[itemIdx].modality;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        modality: action.modality,
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.modality`,
          before,
          after: action.modality,
        },
      };
    }

    case "setEval": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      {
        const { sectionIdx: gsi, itemIdx: gii } = loc;
        const target = model.sections[gsi].items[gii];
        if (isProtected(target)) {
          return {
            model,
            delta: {
              kind: "rejected",
              action,
              reason:
                "item is TEP-protected (shipped or flagged as signed context) — immutable; supersede it instead",
            },
          };
        }
      }
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      const before = item.evals[action.facet];
      const newEvals = { ...item.evals, [action.facet]: action.value };
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => {
        const next = { ...it, evals: newEvals };
        // Human override drops the facet's factor — the worker's old
        // justification no longer applies to the human's score.
        if (it.evalFactors !== undefined) {
          const factors = { ...it.evalFactors };
          delete factors[action.facet];
          if (factors.complexity === undefined && factors.risk === undefined) {
            delete next.evalFactors;
          } else {
            next.evalFactors = factors;
          }
        }
        return next;
      });
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.evals.${action.facet}`,
          before,
          after: action.value,
        },
      };
    }

    case "deferItem": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const before = model.sections[sectionIdx].items[itemIdx].state;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        state: "deferred",
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.state`,
          before,
          after: "deferred",
        },
      };
    }

    case "resolveItem": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const before = model.sections[sectionIdx].items[itemIdx].state;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        state: "resolved",
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.state`,
          before,
          after: "resolved",
        },
      };
    }

    case "dropItem": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      {
        const { sectionIdx: gsi, itemIdx: gii } = loc;
        const target = model.sections[gsi].items[gii];
        if (isProtected(target)) {
          return {
            model,
            delta: {
              kind: "rejected",
              action,
              reason:
                "item is TEP-protected (shipped or flagged as signed context) — immutable; supersede it instead",
            },
          };
        }
      }
      const { sectionIdx, itemIdx } = loc;
      const before = model.sections[sectionIdx].items[itemIdx].state;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        state: "dropped",
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.state`,
          before,
          after: "dropped",
        },
      };
    }

    case "supersedeItem": {
      const newItemLoc = findItem(model, action.itemId);
      if (!newItemLoc) throw new Error(`Item '${action.itemId}' not found`);
      const oldItemLoc = findItem(model, action.supersedes);
      if (!oldItemLoc)
        throw new Error(
          `Item '${action.supersedes}' not found (supersede target)`,
        );

      const before =
        model.sections[newItemLoc.sectionIdx].items[newItemLoc.itemIdx]
          .supersedes;

      // Write supersedes on the new item
      let newModel = updateItemInModel(
        model,
        newItemLoc.sectionIdx,
        newItemLoc.itemIdx,
        (it) => ({ ...it, supersedes: action.supersedes }),
      );
      // Write supersededBy on the old item
      const oldItemLocInNew = findItem(newModel, action.supersedes);
      if (oldItemLocInNew) {
        newModel = updateItemInModel(
          newModel,
          oldItemLocInNew.sectionIdx,
          oldItemLocInNew.itemIdx,
          (it) => ({ ...it, supersededBy: action.itemId }),
        );
      }

      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${newItemLoc.sectionIdx}.items.${newItemLoc.itemIdx}.supersedes`,
          before,
          after: action.supersedes,
        },
      };
    }

    case "proposeEdit": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      {
        const { sectionIdx: gsi, itemIdx: gii } = loc;
        const target = model.sections[gsi].items[gii];
        if (isProtected(target)) {
          return {
            model,
            delta: {
              kind: "rejected",
              action,
              reason:
                "item is TEP-protected (shipped or flagged as signed context) — immutable; supersede it instead",
            },
          };
        }
      }
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      const before = item.pendingEdit;
      const pendingEdit: PendingEdit = {
        oldText: item.text,
        newText: action.newText,
        origin: action.actor as ItemOrigin, // "interpreter" excluded by gate
      };
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        pendingEdit,
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.pendingEdit`,
          before,
          after: pendingEdit,
        },
      };
    }

    case "resolveEdit": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      {
        const { sectionIdx: gsi, itemIdx: gii } = loc;
        const target = model.sections[gsi].items[gii];
        if (isProtected(target)) {
          return {
            model,
            delta: {
              kind: "rejected",
              action,
              reason:
                "item is TEP-protected (shipped or flagged as signed context) — immutable; supersede it instead",
            },
          };
        }
      }
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      if (!item.pendingEdit) {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason: `Item '${action.itemId}' has no pending edit to resolve`,
          },
        };
      }
      const before = item.pendingEdit;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => {
        if (action.accept) {
          return {
            ...it,
            text: it.pendingEdit!.newText,
            pendingEdit: undefined,
          };
        }
        return { ...it, pendingEdit: undefined };
      });
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.pendingEdit`,
          before,
          after: undefined,
        },
      };
    }

    case "addItemNote": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      const noteIdx = item.notes.length;
      const note: Note = {
        id: `note-${item.id}-${noteIdx}`,
        text: action.text,
        by: action.actor,
      };
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        notes: [...it.notes, note],
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.notes.${noteIdx}`,
          before: undefined,
          after: note,
        },
      };
    }

    case "removeNote": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      const noteIdx = item.notes.findIndex((n) => n.id === action.noteId);
      if (noteIdx === -1) {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason: `Note '${action.noteId}' not found on item '${action.itemId}'`,
          },
        };
      }
      const removed = item.notes[noteIdx];
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        notes: it.notes.filter((n) => n.id !== action.noteId),
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.notes`,
          before: removed,
          after: undefined,
        },
      };
    }

    case "attachEvidence": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      const evidenceIdx = item.evidence.length;
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        evidence: [...it.evidence, action.evidence],
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.evidence.${evidenceIdx}`,
          before: undefined,
          after: action.evidence,
        },
      };
    }

    case "linkItems": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      const allIds = new Set(
        model.sections.flatMap((s) => s.items.map((it) => it.id)),
      );
      const merged = [
        ...new Set([
          ...(item.requires ?? []),
          ...action.requires.filter(
            (id) => allIds.has(id) && id !== action.itemId,
          ),
        ]),
      ];
      if (merged.length === (item.requires?.length ?? 0)) {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason: "linkItems added no new valid edges",
          },
        };
      }
      const before = item.requires ?? [];
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        requires: merged,
      }));
      return {
        model: newModel,
        delta: {
          kind: "applied",
          action,
          field: `sections.${sectionIdx}.items.${itemIdx}.requires`,
          before,
          after: merged,
        },
      };
    }

    case "stampShipped": {
      // EXEMPT from the human-only rule — mutates state/shippedIn, never checked
      let currentModel = model;
      for (const itemId of action.itemIds) {
        const loc = findItem(currentModel, itemId);
        if (!loc) continue;
        const { sectionIdx, itemIdx } = loc;
        currentModel = updateItemInModel(
          currentModel,
          sectionIdx,
          itemIdx,
          (it) => ({ ...it, state: "shipped", shippedIn: action.tepId }),
        );
      }
      // Context items the cut drew on: FLAGGED with the TEP — protected from
      // now on (immutable, supersede-only), but still active for future cuts.
      for (const itemId of action.flagIds ?? []) {
        const loc = findItem(currentModel, itemId);
        if (!loc) continue;
        const { sectionIdx, itemIdx } = loc;
        currentModel = updateItemInModel(
          currentModel,
          sectionIdx,
          itemIdx,
          (it) => ({
            ...it,
            flaggedBy: [...new Set([...(it.flaggedBy ?? []), action.tepId])],
          }),
        );
      }
      return {
        model: currentModel,
        delta: {
          kind: "applied",
          action,
          field: "stampShipped",
          before: undefined,
          after: {
            tepId: action.tepId,
            itemIds: action.itemIds,
            flagIds: action.flagIds ?? [],
          },
        },
      };
    }

    case "addRoughRequest": {
      // Append-only: the human's raw words enter the journal and are never
      // edited or removed. Empty requests are refused.
      if (!action.text.trim()) {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason: "empty rough request refused",
          },
        };
      }
      const requests = model.roughRequests ?? [];
      const entry: RoughRequest = {
        id: `req-${requests.length}`,
        text: action.text.trim(),
      };
      return {
        model: { ...model, roughRequests: [...requests, entry] },
        delta: {
          kind: "applied",
          action,
          field: `roughRequests.${requests.length}`,
          before: undefined,
          after: entry,
        },
      };
    }

    case "curateIntent": {
      const before = model.curatedIntent ?? "";
      // Same erasure guard as editGoal: an empty rewrite can never erase a
      // non-empty curated intent, for any actor.
      if (!action.text.trim() && before.trim()) {
        return {
          model,
          delta: {
            kind: "rejected",
            action,
            reason:
              "empty rewrite refused — it would erase a non-empty curated intent",
          },
        };
      }
      const next: WorkingModel = {
        ...model,
        curatedIntent: action.text.trim(),
      };
      // The title tracks its text: a fresh curation without a title clears
      // the stale one rather than pairing old title with new text.
      if (action.title !== undefined && action.title.trim()) {
        next.curatedTitle = action.title.trim().slice(0, 80);
      } else {
        delete next.curatedTitle;
      }
      return {
        model: next,
        delta: {
          kind: "applied",
          action,
          field: "curatedIntent",
          before,
          after: action.text.trim(),
        },
      };
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * True iff the latest readinessHistory record exists AND covered AND cleanCut.
 */
export function freezeEnabled(model: WorkingModel): boolean {
  if (model.readinessHistory.length === 0) return false;
  const latest = model.readinessHistory[model.readinessHistory.length - 1];
  return latest.covered && latest.cleanCut;
}
