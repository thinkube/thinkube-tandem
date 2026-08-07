/**
 * Staleness, computed on read and never stored: a node's grounding claims
 * are current only while its stamp matches the repo's present state.
 * Planned-only nodes make no currency claim until their files are born.
 */
import { Change, Space } from "./schema";
import { SourceStamp, stampsEqual } from "./stamp";

function isStale(node: Change, current: SourceStamp[]): boolean {
  if (!node.grounding) return false;
  if (node.grounding.touchpoints.every((t) => t.planned)) return false;
  if (node.grounding.stamp.length === 0) return false;
  return !stampsEqual(node.grounding.stamp, current);
}

export function staleChangeIds(space: Space, current: SourceStamp[]): Set<string> {
  return new Set(space.nodes.filter((n) => isStale(n, current)).map((n) => n.id));
}

/**
 * Per-file staleness (the honest grain): a promise is out of date ONLY
 * when a file it actually lands in changed since its stamp — never
 * because some unrelated file in the repository moved. `changedSince`
 * answers "which files changed between this recorded head and now,
 * including uncommitted edits"; undefined means the recorded head is
 * unknown (rewritten history) — then the promise is honestly stale.
 */
export async function staleByTouchpoints(
  space: Space,
  changedSince: (root: string, head: string) => Promise<Set<string> | undefined>,
  rootOf: (scope: string | undefined) => string | undefined,
): Promise<Set<string>> {
  const cache = new Map<string, Set<string> | undefined>();
  const stale = new Set<string>();
  for (const n of space.nodes) {
    if (!n.grounding || n.grounding.stamp.length === 0) continue;
    if (n.grounding.touchpoints.every((t) => t.planned)) continue;
    for (const t of n.grounding.touchpoints) {
      if (t.planned) continue;
      const root = rootOf(t.scope) ?? n.grounding.stamp[0]?.root;
      const head = n.grounding.stamp.find((s) => s.root === root)?.head ?? n.grounding.stamp[0]?.head;
      if (!root || !head) continue;
      const key = `${root}@${head}`;
      if (!cache.has(key)) cache.set(key, await changedSince(root, head));
      const changed = cache.get(key);
      if (changed === undefined || changed.has(t.path)) {
        stale.add(n.id);
        break;
      }
    }
  }
  return stale;
}
