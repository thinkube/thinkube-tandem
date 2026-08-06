/**
 * Scope partitioning for a multi-scope TEP (§7quater): changes group by
 * the scope their touchpoints carry ("" = the anchor scope); a change
 * never mixes scopes; cross-scope needs order the batches and a cycle
 * refuses with the reason named. Pure — the session dispatches one batch
 * per scope in the returned order.
 */
import { Cut, Space } from "../core/schema";
import type { SliceForDag } from "../engine/core/dag";

export type ScopePlan =
  | { ok: true; groups: Map<string, string[]>; order: string[] }
  | { ok: false; reason: string };

export function planScopes(space: Space, cut: Cut): ScopePlan {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const scopeOf = (id: string): string | { mixed: string[] } => {
    const scopes = [
      ...new Set((byId.get(id)?.grounding?.touchpoints ?? []).map((t) => t.scope ?? "")),
    ];
    return scopes.length <= 1 ? (scopes[0] ?? "") : { mixed: scopes };
  };
  const groups = new Map<string, string[]>();
  for (const id of cut.changeIds) {
    const n = byId.get(id);
    if (!n) continue;
    const sc = scopeOf(id);
    if (typeof sc !== "string")
      return {
        ok: false,
        reason: `"${n.sentence}" mixes scopes (${sc.mixed
          .map((x) => x || "anchor")
          .join(", ")}) — a change never crosses scopes; split it`,
      };
    if (!groups.has(sc)) groups.set(sc, []);
    groups.get(sc)!.push(id);
  }
  const needsOf = (sc: string): Set<string> => {
    const out = new Set<string>();
    for (const id of groups.get(sc)!)
      for (const need of byId.get(id)?.needs ?? []) {
        const other = scopeOf(need);
        if (typeof other === "string" && other !== sc && groups.has(other)) out.add(other);
      }
    return out;
  };
  const order: string[] = [];
  const marks = new Map<string, number>();
  const visit = (sc: string): boolean => {
    const m = marks.get(sc) ?? 0;
    if (m === 2) return true;
    if (m === 1) return false;
    marks.set(sc, 1);
    for (const dep of needsOf(sc)) if (!visit(dep)) return false;
    marks.set(sc, 2);
    order.push(sc);
    return true;
  };
  for (const sc of [...groups.keys()].sort())
    if (!visit(sc))
      return {
        ok: false,
        reason: "the scopes need each other in a cycle — re-cut so one side lands first",
      };
  return { ok: true, groups, order };
}

/** Qualify every grounded path with a scope prefix — the engine works
 *  repo-root-relative while grounding stayed subtree-relative. */
export function qualifySpace(space: Space, prefix: string): Space {
  if (!prefix) return space;
  return {
    ...space,
    nodes: space.nodes.map((n) =>
      n.grounding
        ? {
            ...n,
            grounding: {
              ...n.grounding,
              touchpoints: n.grounding.touchpoints.map((t) => ({
                ...t,
                path: `${prefix}/${t.path}`,
              })),
            },
          }
        : n,
    ),
  };
}

/** Probe footprints follow the same prefix as the code they grade. */
export function qualifyProbes(slices: SliceForDag[], prefix: string): void {
  if (!prefix) return;
  for (const sl of slices)
    for (const u of sl.workUnits)
      if (u.role === "test") u.footprint = u.footprint.map((f) => `${prefix}/${f}`);
}
