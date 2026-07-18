/**
 * Derived risk (expansion redesign 2026-07-18).
 *
 * Risk scores the potential inability to fulfil the intent — nothing else.
 * It is DERIVED, not judged: an element's risk is a pure function of the OPEN
 * gaps reachable from it through the `requires` edges the derivation records.
 * Close a gap → risk falls mechanically. Out of human hands, ungameable, and
 * explainable — the rationale names the gaps driving the score, so it visibly
 * shrinks as gaps close.
 *
 * Pure; no vscode, no I/O. The single source of truth for the risk badge, the
 * rationale text, and the freeze/cut-readiness risk dimension.
 */

import type { WorkingModel } from "./model";

export interface RiskResult {
  score: 1 | 2 | 3;
  /** The open gaps driving the score (their texts), in document order. */
  openGaps: string[];
  /** One-line auditable justification for the badge. */
  rationale: string;
}

/** 1–3 bucket by open-gap count. Thresholds live here alone. */
export function riskBucket(openGapCount: number): 1 | 2 | 3 {
  if (openGapCount === 0) return 1;
  if (openGapCount <= 2) return 2;
  return 3;
}

/**
 * Open gaps reachable from an element through undirected `requires` edges —
 * the same closure the cut uses. A gap is OPEN when its state is "active"
 * (resolved / dropped / deferred gaps no longer contribute uncertainty).
 */
export function computeElementRisk(
  model: WorkingModel,
  elementId: string,
): RiskResult {
  const byId = new Map<
    string,
    { kind: string; item: WorkingModel["sections"][0]["items"][0] }
  >();
  for (const s of model.sections)
    for (const it of s.items) byId.set(it.id, { kind: s.kind, item: it });

  // Undirected adjacency over requires edges.
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const { item } of byId.values())
    for (const req of item.requires ?? []) {
      if (byId.has(req)) link(item.id, req);
    }

  // BFS the element's connected component.
  const seen = new Set<string>([elementId]);
  const queue = [elementId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }

  // Collect OPEN gaps in the component, in document order.
  const openGaps: string[] = [];
  for (const s of model.sections) {
    if (s.kind !== "gap") continue;
    for (const it of s.items) {
      if (seen.has(it.id) && it.state === "active") openGaps.push(it.text);
    }
  }

  const score = riskBucket(openGaps.length);
  const rationale =
    openGaps.length === 0
      ? "Risk 1 — no open gaps in reach"
      : `Risk ${score} — ${openGaps.length} open gap${openGaps.length === 1 ? "" : "s"}: ${openGaps
          .map((g) => g.replace(/\s+/g, " ").trim().slice(0, 70))
          .join("; ")}`;

  return { score, openGaps, rationale };
}
