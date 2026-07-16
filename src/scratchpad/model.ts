// ===== Shared working model =====

export type Tenant = "tep" | "spec";
export type Phase = "drafting" | "shaping" | "reframing" | "ready";
export type SectionKind =
  "goal" | "constraints" | "elements" | "gap" | "criteria" | "verification";
export type SectionState = "empty" | "proposed" | "shaping" | "settled";
export type Coverage = "unknown" | "assumed" | "verified";

// ── SP-21/3 item model ──

export type Modality = "mandatory" | "optional";
export type ItemState = "active" | "shipped" | "deferred" | "dropped";
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
  origin: ItemOrigin;
  state: ItemState;
  shippedIn?: string; // TEP id when state === "shipped"
  supersedes?: string;
  supersededBy?: string;
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
  | "stampShipped";

export interface Note {
  id: string;
  text: string;
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
}

export interface WorkingModel {
  tenant: Tenant;
  phase: Phase;
  sections: Section[];
  objections: Objection[];
  readinessHistory: ReadinessRecord[];
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
  | { type: "attachEvidence"; actor: Actor; itemId: string; evidence: Evidence }
  | { type: "stampShipped"; itemIds: string[]; tepId: string };

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
      const newItem: Item = {
        id: `item-${action.sectionId}-${itemIdx}`,
        text: action.item.text,
        checked: false,
        modality: action.item.modality,
        evals: { ...action.item.evals },
        origin: action.actor as ItemOrigin,
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
      const { sectionIdx, itemIdx } = loc;
      const item = model.sections[sectionIdx].items[itemIdx];
      const before = item.evals[action.facet];
      const newEvals = { ...item.evals, [action.facet]: action.value };
      const newModel = updateItemInModel(model, sectionIdx, itemIdx, (it) => ({
        ...it,
        evals: newEvals,
      }));
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

    case "dropItem": {
      const loc = findItem(model, action.itemId);
      if (!loc) throw new Error(`Item '${action.itemId}' not found`);
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
      return {
        model: currentModel,
        delta: {
          kind: "applied",
          action,
          field: "stampShipped",
          before: undefined,
          after: { tepId: action.tepId, itemIds: action.itemIds },
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
