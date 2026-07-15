import type { WorkingModel, SectionKind, ReadinessRecord } from "./model";
import { goalSection } from "./model";
import { uncoveredSections } from "./coverage";

/**
 * The result of a non-committing slice dry run.
 *
 * cleanCut — true when the slicer found a clean decomposition with no gaps.
 * gapSection — the SectionKind (or any string) that caused the gap, or null
 *   when cleanCut is true. Typed as string|null so injected fakes whose return
 *   type uses a separately-compiled SectionKind alias are still assignable.
 * decomposition — the proposed list of work-unit labels/titles.
 */
export interface DryRunResult {
  cleanCut: boolean;
  gapSection: string | null;
  decomposition: string[];
}

/**
 * Injected dependencies for dryRunSlice.
 *
 * runSlicer must NEVER call create_slice or write slice files; it only
 * returns a verdict (cleanCut / gapSection) and the proposed decomposition.
 */
export interface DryRunDeps {
  runSlicer: (intent: string) => Promise<DryRunResult>;
}

/**
 * Invoke the downstream slicer in non-committing mode.
 *
 * Extracts the goal section text and passes it to deps.runSlicer as the
 * "intent" string.  The slicer is responsible for never writing slice files.
 */
export async function dryRunSlice(
  model: WorkingModel,
  deps: DryRunDeps,
): Promise<DryRunResult> {
  const goal = goalSection(model);
  return deps.runSlicer(goal.text);
}

/**
 * Minimal verdict shape needed to build a ReadinessRecord.
 * DryRunResult satisfies this; injected fakes that omit `decomposition` also
 * satisfy it, so session.ts can call toReadinessRecord with a SlicerVerdict.
 */
export interface SlicerVerdict {
  cleanCut: boolean;
  gapSection: string | null;
}

/**
 * Map coverage state and a slicer verdict into the ReadinessRecord that the
 * app stores via the 'recordReadiness' action.
 *
 *   covered    — true iff uncoveredSections(model) is empty
 *   cleanCut   — copied from the verdict
 *   gapSection — copied from the verdict
 */
export function toReadinessRecord(
  model: WorkingModel,
  dry: SlicerVerdict,
): ReadinessRecord {
  return {
    covered: uncoveredSections(model).length === 0,
    cleanCut: dry.cleanCut,
    // gapSection is string|null on SlicerVerdict/DryRunResult; the cast is safe
    // because real slicers always return a valid SectionKind string.
    gapSection: dry.gapSection as SectionKind | null,
  };
}
