/**
 * Staged implications, read off the push: each is a decision already in
 * force whose consequence has not yet been applied or set aside. A row
 * carries the decision's own words, the ask it would re-derive, and how
 * many promises that re-derivation touches — nothing worked out twice,
 * since `SpacePush.impacts` already carries exactly this.
 */
import { SpacePush } from "./surfaceContract";

export interface ImplicationRow {
  id: string;
  decision: string;
  askText: string;
  affected: number;
  apply: { action: "accept-impact"; impactId: string };
  setAside: { action: "dismiss-impact"; impactId: string };
}

/** One row per staged implication, plus a single apply-all act carried on
 *  the returned array itself — present only once two or more are staged,
 *  since one press only earns its keep when it replaces more than one. */
export function implicationRows(push: SpacePush): ImplicationRow[] & { applyAll?: { action: "apply-all-impacts" } } {
  const rows: ImplicationRow[] & { applyAll?: { action: "apply-all-impacts" } } = push.impacts.map((impact) => ({
    id: impact.id,
    decision: impact.decision,
    askText: impact.askText,
    affected: impact.affected,
    apply: { action: "accept-impact", impactId: impact.id },
    setAside: { action: "dismiss-impact", impactId: impact.id },
  }));
  if (rows.length >= 2) rows.applyAll = { action: "apply-all-impacts" };
  return rows;
}
