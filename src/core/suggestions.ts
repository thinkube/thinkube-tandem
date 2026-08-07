/**
 * Pure transitions for staged suggestions: the merge verdict (accept
 * applies the union; reject vetoes the pair permanently) and membership
 * advancement with proposal minting. The session stays a thin shell.
 */
import { Space } from "./schema";
import { advanceMembership, applyMerge, pairKey } from "./membership";
import { unitEdges } from "./cluster";

export function advanceSpaceMembership(space: Space, author: string): Space {
  const r = advanceMembership({
    nodes: space.nodes,
    units: space.units,
    pins: space.pins,
    vetoes: space.vetoes ?? [],
    existingProposals: space.proposals ?? [],
    mintUnitId: (n) => `unit-${author}-${n}`,
  });
  const kept = (space.proposals ?? []).filter(
    (p) => r.units.some((u) => u.id === p.a) && r.units.some((u) => u.id === p.b),
  );
  const minted = r.newProposals.map((p) => ({
    id: `prop-${author}-${p.a}+${p.b}`,
    ...p,
  }));
  return { ...space, units: r.units, proposals: [...kept, ...minted] };
}

/**
 * One verdict for every suggestion around ONE unit. The machine proposes
 * pairs, but a unit the machine wants to grow is a single decision for the
 * human: everything it wants folded in folds in together, or all of it
 * stays separate and is never proposed again.
 */
export function mergeFamilyVerdict(
  space: Space,
  unitId: string,
  accept: boolean,
): { space: Space; message: string; count: number } | { reason: string } {
  const family = (space.proposals ?? []).filter((p) => p.a === unitId || p.b === unitId);
  if (!family.length) return { reason: `no suggestions touch '${unitId}'` };
  let units = space.units;
  const vetoes = [...(space.vetoes ?? [])];
  for (const p of family) {
    const other = p.a === unitId ? p.b : p.a;
    if (accept) units = applyMerge(units, unitId, other);
    else vetoes.push(pairKey(p.a, p.b));
  }
  const ids = new Set(family.map((p) => p.id));
  return {
    space: {
      ...space,
      units,
      vetoes,
      proposals: (space.proposals ?? []).filter((p) => !ids.has(p.id)),
    },
    message: accept
      ? `Merged ${family.length} suggestion(s) into one unit.`
      : `Kept separate — those ${family.length} pair(s) are never re-proposed.`,
    count: family.length,
  };
}

export { unitEdges };
