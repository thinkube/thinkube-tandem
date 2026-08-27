/**
 * Dependencies the plan must carry and the grounding did not say.
 *
 * A slice's test homes are brought under its promises by its MAINTAIN unit,
 * and a test home cannot compile until the production code it imports has
 * landed — in this slice or another. The code graph knows who imports whom,
 * in any language it can parse; this reads it once before a run and makes
 * each maintain unit consume the production it imports, so the DAG runs it
 * after that code, and no ring is forced into one slice for it.
 */
import type { SliceForDag } from "../engine/core/dag";
import type { Change } from "../core/schema";
import { isMaintainUnit } from "../run/plan";
import { isProbePath, isTestPath } from "../run/testHomes";

/** Paths an "affected" listing names as importers of a node. */
export function importersIn(affected: string): string[] {
  const out = new Set<string>();
  for (const m of affected.matchAll(/\[(?:imports|imports_from|requires|re_exports)\]\s+(\S+?):L\d+/g)) out.add(m[1]);
  return [...out];
}

/**
 * For every maintain unit (the slice's test homes): the production paths,
 * in any slice, that those test homes import — the unit consumes them, so
 * the DAG runs it after the code has landed. `affected(path)` is the graph's
 * importer listing for a path.
 */
export async function bindTestHomeConsumes(
  slices: readonly SliceForDag[],
  affected: (path: string) => Promise<string>,
  log?: (line: string) => void,
): Promise<void> {
  const production = [...new Set(slices.flatMap((s) => s.workUnits.filter((u) => !isMaintainUnit(u) && (u.role ?? "code") === "code").flatMap((u) => u.footprint)))];
  const maintainers = slices.flatMap((s) => s.workUnits.filter(isMaintainUnit).map((u) => ({ slice: s.handle, unit: u })));
  if (!maintainers.length) return;
  const cache = new Map<string, Promise<string[]>>();
  const importersOf = (p: string) => {
    let c = cache.get(p);
    if (!c) {
      c = affected(p).then(importersIn).catch(() => []);
      cache.set(p, c);
    }
    return c;
  };
  for (const m of maintainers) {
    const homes = new Set(m.unit.footprint);
    const consumes: string[] = [];
    for (const p of production) {
      const hit = (await importersOf(p)).find((i) => homes.has(i));
      if (hit) consumes.push(p);
    }
    if (consumes.length) {
      (m.unit as { consumes?: string[] }).consumes = [...new Set([...((m.unit as { consumes?: string[] }).consumes ?? []), ...consumes])];
      log?.(`plan: ${m.slice}'s test homes import ${consumes.length} production file(s) — they are brought under after that code lands (${consumes.slice(0, 3).join(", ")}${consumes.length > 3 ? "…" : ""})`);
    }
  }
}

/**
 * A need between promises that exists only because one promise's test home
 * imports another's production is not a promise-level need: it belongs to
 * the maintain slice, above. Such edges (an earlier reading wrote them into
 * the space) are removed before planning, so rings they force do not merge
 * slices that are otherwise independent.
 */
export async function dropTestHomeOnlyNeeds(
  nodes: readonly Change[],
  affected: (path: string) => Promise<string>,
): Promise<{ from: string; to: string }[]> {
  const homesOf = (n: Change) =>
    (n.grounding?.touchpoints ?? []).map((t) => t.path).filter((p) => isTestPath(p) && !isProbePath(p));
  const productionOf = (n: Change) => (n.grounding?.touchpoints ?? []).map((t) => t.path).filter((p) => !isTestPath(p));
  const cache = new Map<string, Promise<string[]>>();
  const importersOf = (p: string) => {
    let c = cache.get(p);
    if (!c) {
      c = affected(p).then(importersIn).catch(() => []);
      cache.set(p, c);
    }
    return c;
  };
  const dropped: { from: string; to: string }[] = [];
  for (const a of nodes) {
    const homes = new Set(homesOf(a));
    if (!homes.size) continue;
    for (const bId of a.needs) {
      const b = nodes.find((n) => n.id === bId);
      if (!b) continue;
      // A need that a test home explains is the maintain slice's to carry,
      // whatever else may also be true of the two promises: it goes.
      let viaHome = false;
      for (const p of productionOf(b)) {
        if ((await importersOf(p)).some((i) => homes.has(i))) { viaHome = true; break; }
      }
      if (viaHome) {
        a.needs = a.needs.filter((x) => x !== bId);
        dropped.push({ from: a.id, to: bId });
      }
    }
  }
  return dropped;
}
