/**
 * Closing integrity gate (expansion redesign 2026-07-18, stage 5).
 *
 * After derivation, the space must be structurally sound. Three checks, all
 * pure over the model:
 *
 *  - ORPHANS — every constraint/gap/acceptance item must reach at least one
 *    element through the `requires` edges. An orphan is either noise (drop it)
 *    or the signal of a MISSING element (add it). Never silently kept.
 *  - COVERAGE — every element should carry acceptance; an element with none
 *    cannot be shown to be delivered.
 *  - DUPLICATES — near-duplicate active items (token-overlap ≥ 0.75), the same
 *    similarity the proposal wall uses, surfaced as pairs for the human.
 *
 * The gate REPORTS; it never mutates. Orphans and dupes are the human's to
 * resolve (drop, supersede, or add the missing element).
 */

import type { WorkingModel } from "./model";

export interface IntegrityReport {
  /** Non-element active items that reach no element — {id, kind, text}. */
  orphans: { id: string; kind: string; text: string }[];
  /** Active elements with no acceptance reachable — {id, text}. */
  uncoveredElements: { id: string; text: string }[];
  /** Near-duplicate active item pairs — [{id,text},{id,text}]. */
  duplicates: [{ id: string; text: string }, { id: string; text: string }][];
  /** True when nothing was flagged. */
  clean: boolean;
}

function tokenSet(t: string): Set<string> {
  return new Set(
    t
      .toLowerCase()
      .replace(/[.,;:!?]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size < 4 || b.size < 4) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Undirected reachability set from a start id over requires edges. */
function reachable(
  adj: Map<string, Set<string>>,
  start: string,
): Set<string> {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) ?? [])
      if (!seen.has(nb)) {
        seen.add(nb);
        q.push(nb);
      }
  }
  return seen;
}

export function computeIntegrity(model: WorkingModel): IntegrityReport {
  const byId = new Map<
    string,
    { kind: string; item: WorkingModel["sections"][0]["items"][0] }
  >();
  for (const s of model.sections)
    for (const it of s.items) byId.set(it.id, { kind: s.kind, item: it });

  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const { item } of byId.values())
    for (const req of item.requires ?? [])
      if (byId.has(req)) link(item.id, req);

  const isActiveElement = (id: string): boolean => {
    const e = byId.get(id);
    return !!e && e.kind === "elements" && e.item.state === "active";
  };

  // Orphans: active non-element items reaching no element.
  const orphans: IntegrityReport["orphans"] = [];
  for (const s of model.sections) {
    if (s.kind === "goal" || s.kind === "elements") continue;
    for (const it of s.items) {
      if (it.state !== "active") continue;
      const reach = reachable(adj, it.id);
      if (![...reach].some(isActiveElement)) {
        orphans.push({ id: it.id, kind: s.kind, text: it.text });
      }
    }
  }

  // Coverage: active elements with no acceptance reachable.
  const uncoveredElements: IntegrityReport["uncoveredElements"] = [];
  for (const s of model.sections) {
    if (s.kind !== "elements") continue;
    for (const el of s.items) {
      if (el.state !== "active") continue;
      const reach = reachable(adj, el.id);
      const hasAcceptance = [...reach].some((id) => {
        const e = byId.get(id);
        return e && e.kind === "acceptance" && e.item.state === "active";
      });
      if (!hasAcceptance)
        uncoveredElements.push({ id: el.id, text: el.text });
    }
  }

  // Duplicates: near-duplicate active items across the whole space.
  const actives = [...byId.entries()]
    .filter(([, v]) => v.item.state === "active" && v.kind !== "goal")
    .map(([id, v]) => ({ id, text: v.item.text, tokens: tokenSet(v.item.text) }));
  const duplicates: IntegrityReport["duplicates"] = [];
  for (let i = 0; i < actives.length; i++) {
    for (let j = i + 1; j < actives.length; j++) {
      if (jaccard(actives[i].tokens, actives[j].tokens) >= 0.75) {
        duplicates.push([
          { id: actives[i].id, text: actives[i].text },
          { id: actives[j].id, text: actives[j].text },
        ]);
      }
    }
  }

  return {
    orphans,
    uncoveredElements,
    duplicates,
    clean:
      orphans.length === 0 &&
      uncoveredElements.length === 0 &&
      duplicates.length === 0,
  };
}

/** One-line human summary for the command strip / chat. */
export function integritySummary(r: IntegrityReport): string {
  if (r.clean) return "Integrity check clean — no orphans, no duplicates, every element covered.";
  const parts: string[] = [];
  if (r.orphans.length)
    parts.push(
      `${r.orphans.length} orphan${r.orphans.length === 1 ? "" : "s"} (item${r.orphans.length === 1 ? "" : "s"} tied to no element — drop, or add the missing element)`,
    );
  if (r.uncoveredElements.length)
    parts.push(
      `${r.uncoveredElements.length} element${r.uncoveredElements.length === 1 ? "" : "s"} with no acceptance`,
    );
  if (r.duplicates.length)
    parts.push(`${r.duplicates.length} near-duplicate pair${r.duplicates.length === 1 ? "" : "s"}`);
  return `Integrity check: ${parts.join("; ")}.`;
}
