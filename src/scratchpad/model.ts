// ===== Shared working model =====

export type Tenant = "tep" | "spec";
export type Phase = "drafting" | "shaping" | "reframing" | "ready";
export type SectionKind =
  "goal" | "constraints" | "elements" | "gap" | "criteria" | "verification";
export type SectionState = "empty" | "proposed" | "shaping" | "settled";
export type Coverage = "unknown" | "assumed" | "verified";
export type ToolName =
  | "editGoal"
  | "editSection"
  | "proposeSection"
  | "addNote"
  | "addObjection"
  | "setSectionState"
  | "freeze"
  | "writeArtifact";

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
  | { type: "recordReadiness"; record: ReadinessRecord };

/**
 * Delta describing the single field mutation produced by an action.
 * field = dotted path of the touched field (e.g. "sections.2.text", "goal.text", "sections.1.notes.0").
 * before/after = that field's prior/next VALUE.
 */
export interface Delta {
  action: Action;
  field: string;
  before: unknown;
  after: unknown;
}

/** Create an empty working model — one empty kind:'goal' section, phase 'drafting'. */
export function emptyModel(tenant: Tenant): WorkingModel {
  return {
    tenant,
    phase: "drafting",
    sections: [
      {
        id: "sec-0",
        kind: "goal",
        text: "",
        state: "empty",
        coverage: "unknown",
        notes: [],
        proposals: [],
      },
    ],
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
 * Pure reducer — returns a new model plus an explicit before/after delta.
 * Never mutates the input model.
 */
export function reduce(
  model: WorkingModel,
  action: Action,
): { model: WorkingModel; delta: Delta } {
  switch (action.type) {
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
        delta: { action, field: "goal.text", before, after: action.text },
      };
    }

    case "editGoal": {
      const goalIdx = model.sections.findIndex((s) => s.kind === "goal");
      if (goalIdx === -1) throw new Error("No goal section");
      const goal = model.sections[goalIdx];
      const before = goal.text;
      const newGoal: Section = { ...goal, text: action.text };
      const newSections = [...model.sections];
      newSections[goalIdx] = newGoal;
      return {
        model: { ...model, sections: newSections },
        delta: { action, field: "goal.text", before, after: action.text },
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
      };
      return {
        model: { ...model, sections: [...model.sections, newSection] },
        delta: {
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
        model: {
          ...model,
          objections: [...model.objections, objection],
        },
        delta: {
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
        delta: { action, field: "phase", before, after: action.phase },
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
          action,
          field: `readinessHistory.${histIdx}`,
          before: undefined,
          after: action.record,
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
