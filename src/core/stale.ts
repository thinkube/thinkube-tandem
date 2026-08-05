/**
 * Staleness, computed on read and never stored: a node's grounding claims
 * are current only while its stamp matches the repo's present state.
 * Planned-only nodes make no currency claim until their files are born.
 */
import { ChangeNode, Space } from "./schema";
import { SourceStamp, stampsEqual } from "./stamp";

export function isStale(node: ChangeNode, current: SourceStamp[]): boolean {
  if (!node.grounding) return false;
  if (node.grounding.touchpoints.every((t) => t.planned)) return false;
  if (node.grounding.stamp.length === 0) return false;
  return !stampsEqual(node.grounding.stamp, current);
}

export function staleNodeIds(space: Space, current: SourceStamp[]): Set<string> {
  return new Set(space.nodes.filter((n) => isStale(n, current)).map((n) => n.id));
}
