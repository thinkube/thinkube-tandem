import type { WorkingModel, SectionKind } from "./model";

/**
 * Item-derived coverage (SP-21/3 contract, part 4):
 *
 *   - A non-goal section is covered ⟺ it has ≥ 1 checked active item.
 *   - The goal section is covered ⟺ its text (the intent) is non-empty.
 *
 * Returns the kinds of every section whose coverage fails that rule.
 * An empty result means all sections are green (fully covered).
 */
export function uncoveredSections(model: WorkingModel): SectionKind[] {
  const uncovered: SectionKind[] = [];
  for (const s of model.sections) {
    if (s.kind === "goal") {
      // Goal is covered when intent text is non-empty
      if (!s.text.trim()) {
        uncovered.push(s.kind);
      }
    } else {
      // Non-goal: covered when ≥ 1 item is checked AND state === "active"
      const hasCheckedActive = s.items.some(
        (it) => it.checked && it.state === "active",
      );
      if (!hasCheckedActive) {
        uncovered.push(s.kind);
      }
    }
  }
  return uncovered;
}
