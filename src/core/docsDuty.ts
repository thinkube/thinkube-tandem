/**
 * The one rule that says whether a cut's documentation decision is settled:
 * it lands documentation, it carries a recorded exemption, or it owes
 * documentation and has neither. Every place that needs this verdict —
 * signing, the cut screen, the push to the surface — reads it from here
 * instead of re-deriving it.
 */
import { Cut, Space } from "./schema";

const DOCS_PREFIX = "docs/";

export function docsDuty(
  space: Space,
  cut: Cut,
): { state: "landed" | "exempt" | "missing"; landings: string[]; reason?: string } {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.changeIds.map((id) => byId.get(id)).filter((n) => !!n);
  const landings = [
    ...new Set(
      members.flatMap((n) => (n!.grounding?.touchpoints ?? []).map((t) => t.path)).filter((p) => p.startsWith(DOCS_PREFIX)),
    ),
  ].sort();
  if (landings.length > 0) return { state: "landed", landings };
  if (cut.docsExemption) return { state: "exempt", landings, reason: cut.docsExemption.reason };
  return { state: "missing", landings };
}
