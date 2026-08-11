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
