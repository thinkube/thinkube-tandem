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

// ─── Tandem (files-first, 3-column) gates ────────────────────────────────
//
// The Tandem board has three columns — Ready → Doing → Done — and two gates,
// keyed by *destination* column (ADR-0003/0007):
//
//   → Ready : the slice's parent Spec has a non-empty `## Acceptance Criteria`.
//   → Done  : every acceptance criterion on the parent Spec is checked.
//
// The "→ Done" gate's other half — verifier green for the slice — is a runtime
// check enforced by `/pair-next`, not a file check. Ready→Doing and any other
// move is ungated. These reuse the same body-reading checks as the 6-column
// gates above; the legacy `gateForTransition` / `GateName` stay until their
// consumers are removed (migration phases 5–7).

export type TandemGateName = "to-ready" | "to-done";

/**
 * Resolve the Tandem gate for a move by its destination column. Returns
 * `undefined` for ungated moves (e.g. → Doing); callers treat absence as ok.
 */
export function gateForTandemTransition(
  toColumn: string,
): TandemGateName | undefined {
  if (toColumn === "Ready") return "to-ready";
  if (toColumn === "Done") return "to-done";
  return undefined;
}

/** Run a Tandem gate against the parent Spec's body. */
export function runTandemGate(
  gate: TandemGateName,
  input: SpecBodyInput,
): GateResult {
  switch (gate) {
    case "to-ready":
      return gateSpecToReady(input);
    case "to-done":
      return gateReviewToVerify(input);
  }
}

// ─── Per-slice → Done gate (SP-6: the mechanical half) ───────────────────
//
// The → Done gate above (`gateReviewToVerify`) is whole-Spec: it wants *every*
// criterion checked. That can't gate a single slice on a multi-slice Spec —
// the first slice would be stuck until the last. The mechanical half SP-6 wires
// into `move_slice` is instead keyed by the slice's own `satisfies` ordinals:
// a slice may enter Done only once the criteria *it* delivers are checked. This
// is a sequencing/integrity check, not independent review — the same contract
// that authorises the AI to check the boxes also requires Done to stay
// unreachable while the Spec document lags the board.

export interface SatisfiesGateInput {
  /** Parent Spec body — its `## Acceptance Criteria` is read. */
  specBody: string | null | undefined;
  /** 1-based AC ordinals the slice delivers (frontmatter `satisfies`). */
  satisfies: number[] | null | undefined;
}

export type SatisfiesGateResult =
  | { ok: true; gateSkipped?: string }
  | { ok: false; reason: string };

/**
 * Gate a slice's move to Done by its `satisfies` ordinals. Refuses (naming the
 * offending ordinal + its text) when any listed criterion is unchecked or
 * out-of-range on the parent Spec. Legacy-tolerant: a slice with no ordinals is
 * not gated — `{ ok: true, gateSkipped: "no satisfies field" }` — so slices
 * authored before this field keep moving.
 */
export function gateSliceSatisfiesToDone(
  input: SatisfiesGateInput,
): SatisfiesGateResult {
  const raw = Array.isArray(input.satisfies) ? input.satisfies : [];
  const ordinals = [
    ...new Set(raw.filter((n) => Number.isInteger(n) && n > 0)),
  ].sort((a, b) => a - b);
  if (ordinals.length === 0) {
    return { ok: true, gateSkipped: "no satisfies field" };
  }
  const items = extractAcceptanceCriteria(input.specBody ?? "");
  const problems: string[] = [];
  for (const ordinal of ordinals) {
    const item = items[ordinal - 1];
    if (!item) {
      problems.push(
        `#${ordinal} (the parent Spec lists ${items.length} acceptance ${items.length === 1 ? "criterion" : "criteria"})`,
      );
    } else if (!item.checked) {
      problems.push(`#${ordinal} ("${clampLabel(item.label)}")`);
    }
  }
  if (problems.length === 0) return { ok: true };
  const noun =
    problems.length === 1
      ? "acceptance criterion is"
      : "acceptance criteria are";
  return {
    ok: false,
    reason:
      `Cannot move to Done: this slice's satisfied ${noun} not checked on the parent Spec — AC ${problems.join(", ")}. ` +
      `Check the box(es) under the Spec's ## Acceptance Criteria, then retry the move.`,
  };
}

function clampLabel(label: string, max = 100): string {
  const s = label.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
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
