/**
 * Dependencies the plan must carry and the grounding did not say.
 *
 * A promise that brings an existing test home under a rule depends on the
 * production code that test imports — and when that code is another
 * promise's landing, the tester's edit cannot compile until that promise
 * has landed. Left unsaid, the run orders them wrong and the first waits on
 * the second at run time. The code graph knows who imports whom, in any
 * language it can parse; this reads it once before a run and adds the
 * missing `needs`, so the order is right before anything starts.
 */
import type { Change } from "../core/schema";
import { isProbePath, isTestPath } from "../run/testHomes";

/** Paths an "affected" listing names as importers of a node. */
export function importersIn(affected: string): string[] {
  const out = new Set<string>();
  for (const m of affected.matchAll(/\[(?:imports|imports_from|requires|re_exports)\]\s+(\S+?):L\d+/g)) out.add(m[1]);
  return [...out];
}

export interface TestHomeNeed {
  /** The promise whose test home depends. */
  from: string;
  /** The promise whose production code it imports. */
  to: string;
  /** The test home, and the production path it imports. */
  via: { testHome: string; imports: string };
}

/**
 * For every pair of promises in `nodes`: when A brings a test home under
 * and that test home imports a production path B lands in, A needs B.
 * `affected(path)` is the graph's importer listing for a path.
 */
export async function testHomeNeeds(
  nodes: readonly Change[],
  affected: (path: string) => Promise<string>,
): Promise<TestHomeNeed[]> {
  const needs: TestHomeNeed[] = [];
  const homesOf = (n: Change) =>
    (n.grounding?.touchpoints ?? []).map((t) => t.path).filter((p) => isTestPath(p) && !isProbePath(p));
  const productionOf = (n: Change) =>
    (n.grounding?.touchpoints ?? []).map((t) => t.path).filter((p) => !isTestPath(p));
  const withHomes = nodes.filter((n) => homesOf(n).length);
  if (!withHomes.length) return needs;
  const importerCache = new Map<string, Promise<string[]>>();
  const importersOf = (p: string) => {
    let c = importerCache.get(p);
    if (!c) {
      c = affected(p).then(importersIn).catch(() => []);
      importerCache.set(p, c);
    }
    return c;
  };
  for (const a of withHomes) {
    const homes = new Set(homesOf(a));
    for (const b of nodes) {
      if (b.id === a.id || a.needs.includes(b.id) || b.needs.includes(a.id)) continue;
      for (const p of productionOf(b)) {
        const hit = (await importersOf(p)).find((i) => homes.has(i));
        if (hit) {
          needs.push({ from: a.id, to: b.id, via: { testHome: hit, imports: p } });
          break;
        }
      }
    }
  }
  return needs;
}
