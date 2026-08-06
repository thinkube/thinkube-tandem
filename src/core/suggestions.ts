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

export function mergeVerdict(
  space: Space,
  proposalId: string,
  accept: boolean,
): { space: Space; message: string } | { reason: string } {
  const p = (space.proposals ?? []).find((x) => x.id === proposalId);
  if (!p) return { reason: `no proposal '${proposalId}'` };
  const rest = (space.proposals ?? []).filter((x) => x.id !== proposalId);
  if (accept)
    return {
      space: { ...space, units: applyMerge(space.units, p.a, p.b), proposals: rest },
      message: "Merged.",
    };
  return {
    space: { ...space, proposals: rest, vetoes: [...(space.vetoes ?? []), pairKey(p.a, p.b)] },
    message: "Rejected — that pair will never be re-proposed.",
  };
}

export { unitEdges };
