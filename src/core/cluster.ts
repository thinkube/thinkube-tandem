/**
 * Unit formation: nodes cluster by REAL coupling — where they land in the
 * code and how densely they depend on each other — never by which ask they
 * came from. The rules:
 *  - two nodes touching the same FILE are one unit (they are one change);
 *  - two nodes coupled by two or more signals (shared modules, crossing
 *    needs-edges) are one unit (dense coupling);
 *  - a single needs-edge alone is an ordinary dependency between two units.
 */
import { Change, Unit } from "./schema";
import * as path from "node:path";

const COUPLING_THRESHOLD = 2;

function moduleOf(p: string): string {
  const dir = path.dirname(p);
  return dir === "." ? p : dir;
}

/** Count the coupling signals between two nodes. */
export function couplingOf(a: Change, b: Change): number {
  const filesA = new Set((a.grounding?.touchpoints ?? []).map((t) => t.path));
  const filesB = new Set((b.grounding?.touchpoints ?? []).map((t) => t.path));
  for (const f of filesA) if (filesB.has(f)) return COUPLING_THRESHOLD; // same file: decisive
  const modsA = new Set([...filesA].map(moduleOf));
  const modsB = new Set([...filesB].map(moduleOf));
  let signals = 0;
  for (const m of modsA) if (modsB.has(m)) signals++;
  if (a.needs.includes(b.id)) signals++;
  if (b.needs.includes(a.id)) signals++;
  return signals;
}

/**
 * Form units over the nodes: union every pair whose coupling reaches the
 * threshold. Deterministic — input order decides ids, nothing else.
 */
export function formUnits(nodes: readonly Change[]): Unit[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    parent.set(id, cur);
    return cur;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      if (couplingOf(nodes[i], nodes[j]) >= COUPLING_THRESHOLD)
        union(nodes[i].id, nodes[j].id);
    }

  const members = new Map<string, string[]>();
  for (const n of nodes) {
    const root = find(n.id);
    if (!members.has(root)) members.set(root, []);
    members.get(root)!.push(n.id);
  }
  return [...members.values()].map((changeIds, i) => ({
    id: `unit-${i + 1}`,
    changeIds,
  }));
}

/**
 * Dependencies between units: a needs-edge whose ends live in different
 * units. Below the coupling threshold by construction — the ordinary
 * build-order edge, not a merge signal.
 */
export function unitEdges(
  nodes: readonly Change[],
  units: readonly Unit[],
): { from: string; to: string }[] {
  const unitOf = new Map<string, string>();
  for (const u of units) for (const id of u.changeIds) unitOf.set(id, u.id);
  const seen = new Set<string>();
  const edges: { from: string; to: string }[] = [];
  for (const n of nodes)
    for (const need of n.needs) {
      const from = unitOf.get(n.id);
      const to = unitOf.get(need);
      if (!from || !to || from === to) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  return edges;
}
