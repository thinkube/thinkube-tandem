/**
 * Append-only unit membership (TEP-22's clustering doctrine):
 *
 * - The FIRST clustering runs over every unclaimed change at once, mixing
 *   asks freely. From then on, assigned members are FROZEN — no machine
 *   batch may move, remove, or reassign them; only human acts (pins,
 *   accepted merges) reshape units.
 * - A NEW change grows the structure by the unambiguous-edge rule: edges
 *   resolving into exactly one unit join it; several units, or none, form
 *   a new unit.
 * - Strong coupling across two units never merges silently: it stages a
 *   merge proposal the human accepts or rejects — a rejection is a
 *   PERMANENT veto, and near-identical proposals never resurrect it.
 */
import { Change, MergeProposal, Pin, Unit } from "./schema";
import { couplingOf, formUnits } from "./cluster";

const MERGE_OVERLAP_THRESHOLD = 2;

export const pairKey = (a: string, b: string): string => [a, b].sort().join("+");

/** Does `change` couple into `unit` (any member at or above the bar)? */
function couplesInto(change: Change, unit: Unit, byId: Map<string, Change>): boolean {
  return unit.changeIds.some((id) => {
    const member = byId.get(id);
    return !!member && couplingOf(change, member) >= 2;
  });
}

export interface MembershipResult {
  units: Unit[];
  /** Fresh proposals to stage (already filtered against vetoes + existing). */
  newProposals: Omit<MergeProposal, "id">[];
}

/**
 * Advance membership append-only: keep every stored unit intact (dropping
 * only ids whose change no longer exists — a human deletion), cluster the
 * whole unclaimed backlog (first run = the single cross-ask pass), grow by
 * the unambiguous-edge rule, then stage — never apply — merge suggestions
 * for strongly-coupled unit pairs.
 */
export function advanceMembership(args: {
  nodes: Change[];
  units: Unit[];
  pins: Pin[];
  vetoes: string[];
  existingProposals: MergeProposal[];
  mintUnitId: (n: number) => string;
}): MembershipResult {
  const byId = new Map(args.nodes.map((n) => [n.id, n]));
  // Assigned members are frozen; ids of deleted changes fall away.
  let units: Unit[] = args.units
    .map((u) => ({ ...u, changeIds: u.changeIds.filter((id) => byId.has(id)) }))
    .filter((u) => u.changeIds.length > 0);
  const claimed = new Set(units.flatMap((u) => u.changeIds));
  const unclaimed = args.nodes.filter((n) => !claimed.has(n.id));

  let mint = 0;
  const nextId = (): string => args.mintUnitId(units.length + ++mint);

  if (units.length === 0) {
    // The initial single pass over the whole space — cross-ask by design.
    units = formUnits(unclaimed, args.pins).map((u) => ({
      id: nextId(),
      changeIds: u.changeIds,
    }));
  } else {
    for (const change of unclaimed) {
      const touched = units.filter((u) => couplesInto(change, u, byId));
      if (touched.length === 1) touched[0].changeIds = [...touched[0].changeIds, change.id];
      else units.push({ id: nextId(), changeIds: [change.id] });
    }
  }

  // Human pins stay sovereign: 'together' merges immediately (an override,
  // not a proposal); 'apart' splits the pair's shared unit.
  for (const pin of args.pins) {
    const [a, b] = pin.changeIds;
    const ua = units.find((u) => u.changeIds.includes(a));
    const ub = units.find((u) => u.changeIds.includes(b));
    if (pin.kind === "together" && ua && ub && ua !== ub) {
      ua.changeIds = [...ua.changeIds, ...ub.changeIds];
      units = units.filter((u) => u !== ub);
    } else if (pin.kind === "apart" && ua && ub && ua === ub && ua.changeIds.length > 1) {
      ua.changeIds = ua.changeIds.filter((id) => id !== b);
      units.push({ id: nextId(), changeIds: [b] });
    }
  }

  // Staged merge suggestions for strongly-coupled pairs — vetoed pairs and
  // already-staged pairs never re-propose.
  const vetoed = new Set(args.vetoes);
  const staged = new Set(args.existingProposals.map((p) => pairKey(p.a, p.b)));
  const newProposals: Omit<MergeProposal, "id">[] = [];
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++) {
      const cross = units[i].changeIds.reduce(
        (n, idA) =>
          n +
          units[j].changeIds.filter((idB) => {
            const a = byId.get(idA);
            const b = byId.get(idB);
            return !!a && !!b && couplingOf(a, b) >= 2;
          }).length,
        0,
      );
      const key = pairKey(units[i].id, units[j].id);
      if (cross >= MERGE_OVERLAP_THRESHOLD && !vetoed.has(key) && !staged.has(key))
        newProposals.push({ a: units[i].id, b: units[j].id });
    }

  return { units, newProposals };
}

/** Apply an ACCEPTED merge proposal — the only machine-suggested reshape. */
export function applyMerge(units: Unit[], a: string, b: string): Unit[] {
  const ua = units.find((u) => u.id === a);
  const ub = units.find((u) => u.id === b);
  if (!ua || !ub || ua === ub) return units;
  return units
    .filter((u) => u.id !== b)
    .map((u) => (u.id === a ? { ...u, changeIds: [...ua.changeIds, ...ub.changeIds] } : u));
}
