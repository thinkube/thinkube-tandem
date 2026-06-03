/**
 * Spec-change classification — the core of accurate task staleness.
 *
 * A task's parent Spec carries the requirements the task was built against.
 * When the Spec changes *after* a task, the kanban can flag the task "stale"
 * (a "⚠ spec changed — re-verify" nudge). The naive signal — parent issue
 * `updatedAt` newer than the task's — produces false positives: a bulk
 * migration, a label/type change, a status move, or even ticking an
 * acceptance-criteria checkbox all bump `updatedAt` without changing a single
 * requirement.
 *
 * This module narrows staleness to *requirement* changes. It hashes only the
 * Spec's requirement-bearing sections (Acceptance Criteria / Design /
 * Constraints), normalized so that checkbox state doesn't count, and compares
 * the Spec's current hash to the hash the task was last verified against (the
 * "stamp", recorded by `/pair-next`). A task with no stamp is never flagged.
 *
 * Pure + dependency-light (only Node's `crypto`) so it is trivially testable.
 */
import { createHash } from "crypto";

export type SpecChangeKind = "none" | "metadata" | "requirements";

/**
 * Markdown headings (level ≤ 2) whose content defines a Spec's *requirements*.
 * Compared case-insensitively. Content under any other top-level section
 * (e.g. "File Structure Plan") is excluded from the requirement hash.
 */
const REQUIREMENT_HEADINGS: ReadonlyArray<string> = [
  "acceptance criteria",
  "design",
  "constraints",
];

/**
 * Extract the requirement-bearing sections from a Spec's markdown, normalized
 * so that non-requirement edits don't change the output:
 *  - only content under the Acceptance Criteria / Design / Constraints headings
 *    (the section heading lines themselves are dropped);
 *  - acceptance-criteria checkbox state (`- [ ]` / `- [x]`) is collapsed to a
 *    single marker, so ticking a box is not a requirement change;
 *  - each line is trimmed and blank lines are dropped.
 *
 * Section boundaries are taken at heading level ≤ 2 (`#` / `##`), so deeper
 * `###` headings inside a requirement section are kept as content rather than
 * ending capture.
 */
export function normalizeRequirementSections(specMarkdown: string): string {
  const lines = specMarkdown.split(/\r?\n/);
  const out: string[] = [];
  let capturing = false;
  for (const raw of lines) {
    const heading = raw.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (heading && heading[1].length <= 2) {
      const title = heading[2].replace(/[*_`]/g, "").trim().toLowerCase();
      capturing = REQUIREMENT_HEADINGS.includes(title);
      continue; // never include the section heading line itself
    }
    if (!capturing) continue;
    const normalized = raw.replace(/^(\s*[-*]\s+)\[[ xX]\]/, "$1[]").trim();
    if (normalized) out.push(normalized);
  }
  return out.join("\n");
}

/**
 * Stable hash of a Spec's normalized requirement sections. Equal hashes ⇒ the
 * requirements are unchanged (metadata, checkbox toggles, and any edit outside
 * the requirement sections leave it untouched).
 */
export function requirementHash(specMarkdown: string): string {
  return createHash("sha1")
    .update(normalizeRequirementSections(specMarkdown))
    .digest("hex");
}

export interface SpecChangeInput {
  /** Parent Spec issue's `updatedAt` (ISO), if known. */
  parentUpdatedAt?: string;
  /** The task's own `updatedAt` (ISO), if known. */
  taskUpdatedAt?: string;
  /** Current requirement-hash of the parent Spec (see {@link requirementHash}). */
  currentReqHash?: string;
  /** Requirement-hash the task was last verified against (the `/pair-next` stamp). */
  stampedReqHash?: string;
}

/**
 * Classify how a task's parent Spec changed relative to the task:
 *  - `requirements`: the Spec's requirement sections changed since the task was
 *    last verified (current hash differs from the stamped hash) → the task is
 *    stale and must be re-verified.
 *  - `metadata`: the parent issue was touched after the task (`updatedAt` moved)
 *    but the requirement-hash is unchanged → a non-substantive change
 *    (issue-type/label/sub-issue/status/comment, or an AC checkbox toggle).
 *  - `none`: nothing relevant changed, the hashes match with no later parent
 *    touch, or the task has no verification baseline yet (un-verified work is
 *    never flagged stale — backward-compatible).
 *
 * Pure: depends only on its inputs.
 */
export function classifySpecChange(input: SpecChangeInput): SpecChangeKind {
  const { parentUpdatedAt, taskUpdatedAt, currentReqHash, stampedReqHash } =
    input;

  // No baseline recorded → never flag (un-verified work, or pre-stamp tasks).
  if (!stampedReqHash) return "none";

  // Requirement sections changed since the task was verified → stale. Guard on
  // a known current hash: if we couldn't compute it, fall through rather than
  // false-flag.
  if (currentReqHash !== undefined && currentReqHash !== stampedReqHash) {
    return "requirements";
  }

  // Requirement-hash unchanged. If the parent was touched after the task, it
  // was a metadata-only change; otherwise nothing relevant changed.
  if (parentUpdatedAt && taskUpdatedAt) {
    const p = Date.parse(parentUpdatedAt);
    const t = Date.parse(taskUpdatedAt);
    if (Number.isFinite(p) && Number.isFinite(t) && p > t) return "metadata";
  }
  return "none";
}

/**
 * A task is "stale" (needs re-verification) only when its parent Spec's
 * requirements changed since the task was last verified. Metadata changes and
 * checkbox toggles are not stale.
 */
export function isSpecStale(input: SpecChangeInput): boolean {
  return classifySpecChange(input) === "requirements";
}
