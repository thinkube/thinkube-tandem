import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { loadTemplate } from "../promptTemplates";
// ── Atomic, resumable per-slice commit ────
//
// Today commit is all-or-nothing at run quiescence, so a partial gate or a git
// failure can leave a slice on `Done` with uncommitted work — a sticky-Done lie. SL-3
// reworks the finalize tail to **commit-before-Done, per slice**, and makes a re-run
// **resume** rather than re-author. Two pure functions are the single contract the
// `OrchestratorService` shell + the AC4 test read:
//
//   • `commitPlan(sliceOutcomes)` — the per-slice DECISION: which slices are eligible to
//     commit-then-Done (units landed ∧ gate-green) and which must roll back to `ready`.
//   • `resumeDecision(sliceState)` — what a (re-)run does with a slice it encounters:
//     `'author'` (run the units), `'commit'` (work is already present uncommitted — commit
//     it WITHOUT re-authoring), or `'skip'` (already committed/Done/archived — leave it).
//
// Both are I/O-free: the shell supplies the observed state, acts on the verdict (real git),
// and — because commit itself is I/O that can fail — applies the **commit-failure protocol**
// documented on `commitPlan`: attempt each `commit` handle's git commit; a handle whose commit
// fails is treated as a rollback (→ `ready`, NOT Done), so only commit-succeeded slices end Done.

/** One slice's outcome feeding the per-slice commit decision. */
export interface SliceOutcome {
  /** Slice handle, e.g. "SP-3_SL-2". */
  handle: string;
  /** Did every execution unit of this slice land (its worker(s) finished, no needs-input / failure)? */
  unitsLanded: boolean;
  /** Did this slice's closing-gate verifications all pass? A slice with no gate of its own inherits
   *  the run-level verdict — the shell passes the effective (per-slice) result here. */
  gatePassed: boolean;
}

/**
 * The per-slice commit decision. `commit` lists the handles whose work is complete
 * AND gate-green — the shell commits each (commit-before-Done) then marks it Done. `rollback` lists
 * the handles that must NOT end Done — moved back to `ready` so a later run re-attempts them.
 */
export interface CommitPlan {
  /** Handles eligible to commit-then-Done (units landed ∧ gate passed). */
  commit: string[];
  /** Handles rolled back to `ready` (units didn't all land, or the gate failed). */
  rollback: string[];
}

/**
 * Pure per-slice commit planner: partition the run's slice
 * outcomes into the slices to **commit** (every unit landed ∧ the slice's gate passed) and the
 * slices to **roll back** to `ready` (anything else — partial landing or a failed gate). This is
 * the no-sticky-Done invariant: a slice is only ever committed-then-Done when its work is complete
 * and green, so a partial-gate failure rolls the rest to `ready` rather than freezing them Done.
 *
 * Commit is I/O that can still fail at the git layer (e.g. AC4's fake git that fails one slice's
 * commit). The shell honours this **commit-failure protocol**: attempt each `commit` handle's git
 * commit in order; if a commit fails, treat that handle as a rollback (→ `ready`, NOT Done). Only
 * handles whose commit actually succeeded end Done — so no slice is ever Done with uncommitted work.
 */
export function commitPlan(sliceOutcomes: SliceOutcome[]): CommitPlan {
  const commit: string[] = [];
  const rollback: string[] = [];
  for (const o of sliceOutcomes ?? []) {
    if (o && o.unitsLanded && o.gatePassed) commit.push(o.handle);
    else if (o) rollback.push(o.handle);
  }
  return { commit, rollback };
}

/** What a slice looks like at the start of a (re-)run, for the resume decision. */
export interface SliceState {
  /** Frontmatter status: ready | doing | done | requires-attention | archived. */
  status: string;
  /** Did every execution unit of this slice already land — its work present in the worktree? */
  unitsLanded: boolean;
  /** Has this slice's work already been committed (a commit SHA recorded for it)? */
  committed: boolean;
}

/**
 * Pure resume planner: decide what a (re-)run does with a slice it
 * encounters, so a resume **commits** rather than **re-authors** already-present work — the AC4
 * invariant the spy `runUnit` asserts (not called for a complete-but-uncommitted slice on re-run).
 *
 *   • `'skip'`   — archived, or already committed (Done): nothing to do.
 *   • `'commit'` — units already landed but NOT yet committed (complete-but-uncommitted): commit it
 *                  WITHOUT re-authoring — the frontier never re-dispatches a worker for it.
 *   • `'author'` — work not yet present: (re-)author the units as normal.
 */
export function resumeDecision(
  sliceState: SliceState,
): "author" | "commit" | "skip" {
  const status = (sliceState?.status ?? "").toLowerCase();
  if (status === "archived") return "skip";
  if (sliceState?.committed) return "skip";
  if (sliceState?.unitsLanded) return "commit";
  return "author";
}

