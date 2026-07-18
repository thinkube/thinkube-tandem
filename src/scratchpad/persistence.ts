import type { WorkingModel } from "./model";

/**
 * Serialize the full working model (including phase, sections, objections,
 * readinessHistory) to a JSON string.
 */
export function serialize(model: WorkingModel): string {
  return JSON.stringify(model);
}

/**
 * Deserialize a previously serialized working model.
 * Round-trip guarantee: deserialize(serialize(m)) deep-equals m.
 */
export function deserialize(text: string): WorkingModel {
  return migrateSections(JSON.parse(text) as WorkingModel);
}

/**
 * Section migration (expansion redesign 2026-07-18): old spaces carry separate
 * `criteria` and `verification` sections; they merge into one `acceptance`
 * section (criteria renamed, verification items appended). Item ids and edges
 * are untouched — only the section grouping changes. A no-op on new spaces.
 */
function migrateSections(model: WorkingModel): WorkingModel {
  type LooseSection = { kind: string; items: unknown[] } & Record<string, unknown>;
  const sections = model.sections as unknown as LooseSection[];
  const hasLegacy = sections.some(
    (s) => s.kind === "criteria" || s.kind === "verification",
  );
  if (!hasLegacy) return model;
  const verification = sections.find((s) => s.kind === "verification");
  const merged: LooseSection[] = sections
    .filter((s) => s.kind !== "verification")
    .map((s) =>
      s.kind === "criteria"
        ? {
            ...s,
            kind: "acceptance",
            items: [...s.items, ...(verification ? verification.items : [])],
          }
        : s,
    );
  return { ...model, sections: merged as unknown as WorkingModel["sections"] };
}
