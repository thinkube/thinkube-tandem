/**
 * Quality gates for kanban column transitions.
 *
 * Pure functions: take an input shape, return `{ ok: true } | { ok: false,
 * reason: string }`. No I/O — the caller (kanban adapter, MCP server,
 * `/pair-next` skill) is responsible for fetching what the gate needs.
 *
 * Three gates ship in v0.1.0, one per workflow boundary:
 *
 *   Spec        → Ready     `gateSpecToReady`      (acceptance criteria checklist not empty)
 *   In Progress → Review    `gateInProgressToReview` (at least one comment exists)
 *   Review      → Verify    `gateReviewToVerify`   (all acceptance criteria boxes checked)
 *
 * Gates 1 and 3 read the spec body's `## Acceptance Criteria` section.
 * Both `## acceptance criteria` and `## Acceptance Criteria` are recognised
 * (case-insensitive); any of `- [ ]`, `- [x]`, `* [ ]`, `+ [x]` count as
 * checklist items. The section ends at the next `## ` heading or end-of-file.
 *
 * Gate 2 currently checks the existence of any comment. The plan's longer
 * goal is "at least one comment from this work cycle" — tracking the
 * card's last "In Progress" timestamp is a chunk-13 refinement. For v0.1.0
 * the simpler form catches the common case (someone forgot to leave any
 * note about the work).
 */

export type GateResult = { ok: true } | { ok: false; reason: string };

export interface SpecBodyInput {
  /** Issue body text. Pass either the GitHub issue body or the linked `.thinkube/specs/SP-{n}.md` body — both share the same convention. */
  specBody: string | null | undefined;
}

export interface CommentsInput {
  /** Total comment count on the issue. Sufficient for the v0.1.0 form of gate 2. */
  commentCount: number;
}

export function gateSpecToReady(input: SpecBodyInput): GateResult {
  const items = extractAcceptanceCriteria(input.specBody ?? "");
  if (items.length === 0) {
    return {
      ok: false,
      reason:
        "Cannot move to Ready: spec has no `## Acceptance Criteria` checklist. Add at least one `- [ ]` item under that heading.",
    };
  }
  return { ok: true };
}

export function gateInProgressToReview(input: CommentsInput): GateResult {
  if (input.commentCount === 0) {
    return {
      ok: false,
      reason:
        "Cannot move to Review: no comments on the issue. Leave at least one comment summarising the change (link to the PR, summary of the approach, etc.).",
    };
  }
  return { ok: true };
}

export function gateReviewToVerify(input: SpecBodyInput): GateResult {
  const items = extractAcceptanceCriteria(input.specBody ?? "");
  if (items.length === 0) {
    return {
      ok: false,
      reason:
        "Cannot move to Verify: parent spec has no `## Acceptance Criteria` checklist to verify against.",
    };
  }
  const unchecked = items.filter((i) => !i.checked);
  if (unchecked.length > 0) {
    return {
      ok: false,
      reason: `Cannot move to Verify: ${unchecked.length} acceptance criterion${unchecked.length === 1 ? "" : "ia"} still unchecked in parent spec.`,
    };
  }
  return { ok: true };
}

export interface AcceptanceItem {
  label: string;
  checked: boolean;
}

/**
 * Extract checkbox items under the `## Acceptance Criteria` heading. Returns
 * `[]` when the section is missing or empty. Exported for direct use by the
 * `/pair-next` skill and MCP tools that want to inspect criteria.
 */
export function extractAcceptanceCriteria(body: string): AcceptanceItem[] {
  const lines = body.split(/\r?\n/);
  let inSection = false;
  const items: AcceptanceItem[] = [];
  for (const rawLine of lines) {
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(rawLine);
    if (heading) {
      const text = heading[2].trim().toLowerCase();
      inSection =
        text === "acceptance criteria" || text === "acceptance_criteria";
      continue;
    }
    if (!inSection) continue;
    const checkbox = /^\s*[-*+]\s*\[([ xX])\]\s+(.+?)\s*$/.exec(rawLine);
    if (!checkbox) continue;
    items.push({
      label: checkbox[2],
      checked: checkbox[1].toLowerCase() === "x",
    });
  }
  return items;
}

/**
 * Look up the gate for a (fromColumn, toColumn) transition by their human
 * names (matches the methodology bundle's column option values:
 * "Spec", "Ready", "In Progress", "Review", "Verify", "Done").
 *
 * Returns `undefined` when there's no gate for that transition — the move
 * is allowed unconditionally. Callers should treat absence as "ok".
 */
export type TransitionKey = `${string}→${string}`;

export type GateName =
  | "spec-to-ready"
  | "in-progress-to-review"
  | "review-to-verify";

export function gateForTransition(
  fromColumn: string,
  toColumn: string,
): GateName | undefined {
  if (fromColumn === "Spec" && toColumn === "Ready") return "spec-to-ready";
  if (fromColumn === "In Progress" && toColumn === "Review")
    return "in-progress-to-review";
  if (fromColumn === "Review" && toColumn === "Verify")
    return "review-to-verify";
  return undefined;
}

export class GateFailedError extends Error {
  constructor(
    public readonly gate: GateName,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "GateFailedError";
  }
}
