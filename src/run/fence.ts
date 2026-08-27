/**
 * Who owns what, per worktree.
 *
 * A unit is fenced to its own footprint, and a path that belongs to any
 * OTHER unit sharing that tree is that unit's, not a stray. Ownership is
 * not liveness: a unit that has finished leaves its work written, and
 * every test author shares one tree, so the first tester to finish turned
 * its own probes into strays for every tester still running — one of them
 * was blamed for them, they were reverted underneath it, and the run
 * halted. What makes a path a stray is that NOBODY owns it.
 */
export function ownership<U extends { id: string; footprint: string[] }>(
  units: readonly U[],
  treeOf: (u: U) => string,
): (tree: string, selfId: string) => () => string[] {
  const owned = new Map<string, Map<string, string[]>>();
  for (const u of units) {
    const tree = treeOf(u);
    const byId = owned.get(tree) ?? new Map<string, string[]>();
    byId.set(u.id, u.footprint);
    owned.set(tree, byId);
  }
  return (tree, selfId) => () =>
    [...(owned.get(tree) ?? new Map<string, string[]>()).entries()]
      .filter(([id]) => id !== selfId)
      .flatMap(([, paths]) => paths);
}

/**
 * WHY a unit waits, per edge.
 *
 * The engine puts two different things in `requires`: a cross-slice
 * dependency on what another slice alone produces, and the same-slice
 * rule that a coder starts only once its probes exist. Drawn as one
 * arrow they read alike — and only the first is a coupling worth
 * questioning; the second is the method working.
 */
export function waitReasons(
  units: readonly { id: string; slice: string; role?: string; footprint: string[] }[],
  slices: readonly { handle: string; workUnits: { consumes?: string[] }[] }[],
): (unit: { id: string; slice: string }, on: string) => {
  on: string;
  kind: "needs" | "probes";
  what?: string;
} {
  const byId = new Map(units.map((u) => [u.id, u]));
  const consumedBy = new Map(
    slices.map((sl) => [
      sl.handle,
      new Set(sl.workUnits.flatMap((w) => w.consumes ?? [])),
    ]),
  );
  return (unit, on) => {
    const producer = byId.get(on);
    if (producer && producer.slice === unit.slice && (producer.role ?? "code") === "test")
      return { on, kind: "probes" };
    const wanted = consumedBy.get(unit.slice) ?? new Set<string>();
    const file = (producer?.footprint ?? []).find((f) => wanted.has(f));
    return { on, kind: "needs", ...(file ? { what: file } : {}) };
  };
}
