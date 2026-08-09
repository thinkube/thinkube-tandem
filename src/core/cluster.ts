/**
 * Unit formation: a unit is ONE CLAIM — one statable "done".
 *
 * This is the methodology's own rule for a slice, restored: sized by
 * coherence, never by a count. Over-division is the reflex the method
 * rejects — holding a coherent change together costs an AI worker little,
 * while every extra unit adds a hand-off. So the promises that make one
 * claim true are one worker's job, and nothing is split to make it smaller.
 *
 * It used to cluster by shared FILE instead, transitively. That was doing
 * two jobs at once: keeping two workers out of one file, and keeping each
 * file owned by exactly one unit so a dependency — which is declared as a
 * file — resolved to a single producer. The price was that one popular
 * file chained everything that touched anything that touched it: a real
 * cut of 84 promises became a single unit of 71 that no worker could
 * finish. Both jobs now have their own mechanism — the dispatch frontier
 * refuses to run two units over one file at the same moment, and a
 * dependency names only files its producer owns alone — so unit formation
 * is free to be about meaning again.
 *
 * Two things it still must guarantee, because the engine refuses a plan
 * that breaks them:
 *  - a RING of claims that need each other is one unit (a cycle cannot be
 *    ordered, so it cannot be split);
 *  - every cross-unit dependency must be expressible, which means its
 *    producer must own at least one file alone; where it does not, the two
 *    become one unit rather than lose the edge.
 */
import { Change, Unit } from "./schema";

/** The claim a change makes true, or itself when it serves none. */
const claimOf = (n: Change): string => n.servesClaim ?? `alone:${n.id}`;

const filesOf = (n: Change): string[] =>
  (n.grounding?.touchpoints ?? []).map((t) => t.path);

/** Disjoint sets over claim keys, in first-appearance order. */
function partition(keys: string[]): {
  find: (k: string) => string;
  union: (a: string, b: string) => void;
} {
  const parent = new Map<string, string>(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    let cur = k;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    parent.set(k, cur);
    return cur;
  };
  return {
    find,
    union: (a, b) => {
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) parent.set(ra, rb);
    },
  };
}

/** The unit-level dependency edges implied by the changes' `needs`. */
function edges(
  nodes: readonly Change[],
  root: (n: Change) => string,
): Map<string, Set<string>> {
  const rootOfId = new Map(nodes.map((n) => [n.id, root(n)]));
  const out = new Map<string, Set<string>>();
  for (const n of nodes) {
    const from = rootOfId.get(n.id)!;
    for (const need of n.needs) {
      const to = rootOfId.get(need);
      if (!to || to === from) continue;
      if (!out.has(from)) out.set(from, new Set());
      out.get(from)!.add(to);
    }
  }
  return out;
}

/** One cycle among the units, as unit roots — or nothing when acyclic. */
function ring(out: Map<string, Set<string>>, roots: string[]): string[] | undefined {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const walk = (r: string): string[] | undefined => {
    state.set(r, 1);
    stack.push(r);
    for (const next of out.get(r) ?? []) {
      const seen = state.get(next) ?? 0;
      if (seen === 1) return stack.slice(stack.indexOf(next));
      if (seen === 0) {
        const found = walk(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(r, 2);
    return undefined;
  };
  for (const r of roots)
    if ((state.get(r) ?? 0) === 0) {
      const found = walk(r);
      if (found) return found;
    }
  return undefined;
}

/**
 * Form units over the nodes. Deterministic: the claims' first appearance
 * decides the order, and nothing else does.
 */
export function formUnits(nodes: readonly Change[]): Unit[] {
  const keys: string[] = [];
  for (const n of nodes) if (!keys.includes(claimOf(n))) keys.push(claimOf(n));
  const { find, union } = partition(keys);
  const rootOf = (n: Change): string => find(claimOf(n));

  for (;;) {
    const roots = [...new Set(keys.map(find))];
    const out = edges(nodes, rootOf);

    // A ring of claims that need each other cannot be ordered.
    const cycle = ring(out, roots);
    if (cycle) {
      for (const k of cycle.slice(1)) union(cycle[0], k);
      continue;
    }

    // Every dependency must be expressible: a producer names itself to its
    // consumer with a file it alone owns. With none, the two are one unit.
    const owners = new Map<string, Set<string>>();
    for (const n of nodes)
      for (const f of filesOf(n)) {
        if (!owners.has(f)) owners.set(f, new Set());
        owners.get(f)!.add(rootOf(n));
      }
    const sole = new Set(
      [...owners.entries()].filter(([, who]) => who.size === 1).map(([f]) => f),
    );
    const speaks = new Set(
      nodes.filter((n) => filesOf(n).some((f) => sole.has(f))).map(rootOf),
    );
    let merged = false;
    for (const [consumer, producers] of out)
      for (const producer of producers)
        if (!speaks.has(producer)) {
          union(consumer, producer);
          merged = true;
          break;
        }
    if (!merged) break;
  }

  const members = new Map<string, string[]>();
  for (const n of nodes) {
    const root = rootOf(n);
    if (!members.has(root)) members.set(root, []);
    members.get(root)!.push(n.id);
  }
  return [...members.values()].map((changeIds, i) => ({
    id: `unit-${i + 1}`,
    changeIds,
  }));
}
