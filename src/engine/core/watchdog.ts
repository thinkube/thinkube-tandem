import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { loadTemplate } from "../promptTemplates";
// ── Finalization watchdog ────────────────
//
// A run can land every execution unit and then silently wedge — the finalize tail
// (commit the Spec, write DELIVERY.md, advance the slice off `ready`) never fires, so
// the work sits done-but-uncommitted and the loop stalls without surfacing anything.
// `finalizationVerdict` is the pure detector wired into `dispatchSpec`: consulted once
// the run believes it's quiescent, it reports `{ wedged }` when the units are done but
// the finalize markers are absent, so the shell can surface Requires-attention with a
// diagnosis instead of looping forever. The diagnosis text is exported as a constant so
// the test asserts against it (never a hand-copied string that can drift).

/**
 * The single, machine-checkable phrase a finalization wedge is diagnosed with. The watchdog
 * surfaces it (verbatim, possibly with appended specifics) and the test asserts via THIS constant
 * — never a hardcoded copy — so the message and its assertion can never silently diverge.
 */
export const FINALIZATION_WEDGED_DIAGNOSIS =
  "units done but run never finalized";

/**
 * What `finalizationVerdict` inspects: whether the run reached quiescence (every dispatched
 * execution unit landed) and whether each finalize marker is present. A finalized run has a
 * commit SHA, a written DELIVERY.md, and no slice still sitting on `ready`.
 */
export interface FinalizationState {
  /** Did every dispatched execution unit land (the run believes it's complete)? */
  unitsAllDone: boolean;
  /** The HEAD sha the Spec was committed at — falsy (empty/undefined) ⇒ nothing committed. */
  committedSha?: string;
  /** Was the auditable DELIVERY.md report written this run? */
  deliveryWritten: boolean;
  /** Slices still in `ready` after the run — non-empty ⇒ a slice was never advanced off `ready`. */
  slicesStillReady?: string[];
}

/**
 * Pure finalization watchdog: given the run's quiescence + finalize-marker
 * state, return `'finalized'` when the run is healthy (or not yet at the finalize check), or
 * `{ wedged }` when the units are **done** but one or more finalize markers — commit SHA,
 * DELIVERY.md, slice moved off `ready` — are **absent**. The `wedged` string always contains
 * `FINALIZATION_WEDGED_DIAGNOSIS` (assert with that constant, e.g. `.includes` / `toContain`),
 * with the missing markers appended for the operator. When the units are not all done there is
 * nothing to finalize yet, so the verdict is `'finalized'` (no wedge) — the caller is expected to
 * consult this only at run quiescence.
 */
export function finalizationVerdict(
  state: FinalizationState,
): "finalized" | { wedged: string } {
  if (!state.unitsAllDone) return "finalized";
  const missing: string[] = [];
  if (!state.committedSha) missing.push("commit SHA");
  if (!state.deliveryWritten) missing.push("DELIVERY.md");
  if ((state.slicesStillReady ?? []).length) missing.push("slice off `ready`");
  if (!missing.length) return "finalized";
  return {
    wedged: `${FINALIZATION_WEDGED_DIAGNOSIS} (missing: ${missing.join(", ")})`,
  };
}

