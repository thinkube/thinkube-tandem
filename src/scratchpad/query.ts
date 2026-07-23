/**
 * The QUERY ENGINE — one way to ask "which items?".
 *
 * Selection by criteria, inspection, and the revision preview all need the same
 * answer to the same question, so they share one implementation. The agent
 * translates the human's phrasing ("all the constraints related to the first
 * element") into a query; this resolves it EXACTLY against the model. The
 * division is deliberate: wording is the model's job, resolution is code's —
 * an agent that inferred relationships itself would confidently act on edges
 * that do not exist.
 *
 * Criteria combine with AND. `state` defaults to "active" because every caller
 * so far means live items; pass it explicitly to reach shipped/deferred ones.
 */

import type { Item, ItemState, SectionKind, WorkingModel } from "./model";
import { entriesOf } from "./model";
import { anchorElementsFor, buildAdjacency, indexItems } from "./graph";
export { anchorElementsFor, buildAdjacency, indexItems } from "./graph";
import { computeElementRisk } from "./deriveRisk";
import { computeIntegrity } from "./integrityGate";

export interface ItemQuery {
  /** Section the item lives in. */
  kind?: SectionKind;
  /**
   * Relational: items that belong to the same element(s) as this item.
   * An element id matches the element itself plus everything anchored to it;
   * any other id matches items sharing at least one of its anchor elements.
   */
  relatedTo?: string;
  /** Journal entry the item was derived from (goal = 1). */
  servesEntry?: number;
  /** Settled (checked) or not. */
  settled?: boolean;
  /** Lifecycle state. Defaults to "active"; pass "any" for all. */
  state?: ItemState | "any";
  riskAtLeast?: number;
  complexityAtLeast?: number;
  /** Gaps carrying a machine recommendation awaiting ratification. */
  hasDecisionPending?: boolean;
  /** Case-insensitive substring of the item text. */
  textMatches?: string;
  /** Items the machine never placed under an ask (they serve the whole space). */
  unattributed?: boolean;
  /** Items protected by a frozen TEP (flaggedBy) — or, negated, unprotected. */
  isProtected?: boolean;
}

export interface QueryHit {
  id: string;
  kind: SectionKind;
  text: string;
  settled: boolean;
  state: ItemState;
  servesEntries: number[];
  risk?: number;
  complexity?: number;
}

/** An item's risk: derived from open gaps for elements, stored otherwise. */
function riskOf(model: WorkingModel, kind: SectionKind, item: Item): number | undefined {
  if (kind === "elements" && item.state === "active")
    return computeElementRisk(model, item.id).score;
  return item.evals.risk;
}

/** Resolve a query against the model. Pure. */
export function findItems(model: WorkingModel, q: ItemQuery): QueryHit[] {
  const byId = indexItems(model);
  const adj = buildAdjacency(byId);

  // Relational pre-pass: the anchor set the query is asking about.
  let wantedAnchors: Set<string> | undefined;
  if (q.relatedTo !== undefined) {
    if (!byId.has(q.relatedTo)) return [];
    wantedAnchors = new Set(anchorElementsFor(byId, adj, q.relatedTo));
  }

  const unattributedIds =
    q.unattributed === undefined
      ? undefined
      : new Set(
          computeIntegrity(model).unattributed.map((u: { id: string }) => u.id),
        );

  const needle = q.textMatches?.trim().toLowerCase();
  const hits: QueryHit[] = [];

  for (const [id, { kind, item }] of byId) {
    if (kind === "goal") continue;
    const state = q.state ?? "active";
    if (state !== "any" && item.state !== state) continue;
    if (q.kind !== undefined && kind !== q.kind) continue;
    // Matches ANY anchor: an item serving several asks belongs to each of
    // them, and an unattributed item serves them all.
    if (
      q.servesEntry !== undefined &&
      !entriesOf(model, item).includes(q.servesEntry)
    )
      continue;
    if (q.settled !== undefined && item.checked !== q.settled) continue;
    if (q.hasDecisionPending !== undefined &&
        Boolean(item.decisionProposal) !== q.hasDecisionPending)
      continue;
    if (q.isProtected !== undefined &&
        (item.flaggedBy ?? []).length > 0 !== q.isProtected)
      continue;
    if (needle && !item.text.toLowerCase().includes(needle)) continue;
    if (
      unattributedIds !== undefined &&
      unattributedIds.has(id) !== q.unattributed
    )
      continue;

    const risk = riskOf(model, kind, item);
    if (q.riskAtLeast !== undefined && (risk ?? 0) < q.riskAtLeast) continue;
    const complexity = item.evals.complexity;
    if (q.complexityAtLeast !== undefined &&
        (complexity ?? 0) < q.complexityAtLeast)
      continue;

    if (wantedAnchors !== undefined) {
      // The queried item itself always belongs to its own relation.
      if (id !== q.relatedTo) {
        const anchors = anchorElementsFor(byId, adj, id);
        if (!anchors.some((a) => wantedAnchors!.has(a))) continue;
      }
    }

    hits.push({
      id,
      kind,
      text: item.text,
      settled: item.checked,
      state: item.state,
      servesEntries: entriesOf(model, item),
      risk,
      complexity,
    });
  }
  return hits;
}

/** One-line-per-hit rendering, for echoing a selection back before acting. */
export function renderHits(hits: readonly QueryHit[], limit = 40): string {
  if (hits.length === 0) return "(no items match)";
  const shown = hits.slice(0, limit);
  const lines = shown.map((h) => {
    const marks = [
      h.settled ? "✓settled" : undefined,
      h.state !== "active" ? h.state : undefined,
      h.servesEntries.length > 0 ? `entry ${h.servesEntries.join("/")}` : undefined,
      h.risk !== undefined ? `R${h.risk}` : undefined,
    ].filter(Boolean);
    return `  - ${h.id} [${h.kind}${marks.length ? `,${marks.join(",")}` : ""}] ${h.text.slice(0, 160)}`;
  });
  if (hits.length > shown.length)
    lines.push(`  … and ${hits.length - shown.length} more`);
  return lines.join("\n");
}
