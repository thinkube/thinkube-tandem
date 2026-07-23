/**
 * The dependency graph over `requires` edges.
 *
 * Lives on its own because both the model (resolving which asks an item
 * serves) and the query engine (relational selection) need it, and the rule it
 * encodes — ELEMENTS ARE SINKS — is subtle enough that two copies would
 * eventually disagree. Types only from the model, so there is no runtime cycle.
 */

import type { Item, SectionKind, WorkingModel } from "./model";

export interface Indexed {
  kind: SectionKind;
  item: Item;
}

/** id → {section kind, item}, for the whole model. */
export function indexItems(model: WorkingModel): Map<string, Indexed> {
  const byId = new Map<string, Indexed>();
  for (const s of model.sections)
    for (const it of s.items) byId.set(it.id, { kind: s.kind, item: it });
  return byId;
}

/** Undirected adjacency over `requires` edges that resolve to a real item. */
export function buildAdjacency(
  byId: Map<string, Indexed>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const { item } of byId.values())
    for (const req of item.requires ?? [])
      if (byId.has(req)) link(item.id, req);
  return adj;
}

/**
 * The elements an item anchors to: reachable through `requires` edges WITHOUT
 * traversing another element. Elements are sinks — otherwise everything is
 * transitively connected through shared elements and nothing is ever private.
 * This is the same rule parking uses to decide what belongs to a group.
 */
export function anchorElementsFor(
  byId: Map<string, Indexed>,
  adj: Map<string, Set<string>>,
  start: string,
): string[] {
  if (byId.get(start)?.kind === "elements") return [start];
  const anchors = new Set<string>();
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (byId.get(nb)?.kind === "elements") anchors.add(nb);
      else q.push(nb);
    }
  }
  return [...anchors];
}
