/**
 * What is still CURRENT: which promises\' ground moved (stale), and which
 * checks\' standing proofs moved since they were bound (proof drift).
 * Proved-then is never silently shown as proved-now — the claim card
 * reads both sets on every push.
 */
import { Space } from "../core/schema";
import { SourceStamp, stampsEqual } from "../core/stamp";
import { staleByTouchpoints, staleChangeIds } from "../core/stale";
import { filesChangedSince } from "../core/staleFiles";

export async function assessCurrency(
  space: Space,
  deps: {
    repoRoot: string;
    /** Test seam: whole-repo stamp comparison instead of git. */
    readCurrentStamp?: () => Promise<SourceStamp[]>;
    scopeDir: (scope: string) => string | undefined;
  },
): Promise<{ stale: Set<string>; proofDrift: Set<string> }> {
  if (deps.readCurrentStamp) {
    const current = await deps.readCurrentStamp();
    return {
      stale: staleChangeIds(space, current),
      proofDrift: new Set(
        space.nodes.flatMap((n) =>
          n.acceptance
            .filter((a) => a.proof && !stampsEqual(a.proof.stamp, current))
            .map((a) => a.id),
        ),
      ),
    };
  }
  const stale = await staleByTouchpoints(
    space,
    (root, head) => filesChangedSince(root, head),
    (scope) => (scope ? deps.scopeDir(scope) : deps.repoRoot),
  );
  // Anchor drift, at file precision: a proof whose test file changed
  // since the binding was stamped is no longer known to prove anything.
  const proofDrift = new Set<string>();
  const byHead = new Map<string, { id: string; path: string }[]>();
  for (const n of space.nodes)
    for (const a of n.acceptance) {
      const head = a.proof?.stamp[0]?.head;
      if (!a.proof || !head) continue;
      const arr = byHead.get(head) ?? [];
      arr.push({ id: a.id, path: a.proof.path });
      byHead.set(head, arr);
    }
  for (const [head, anchors] of byHead) {
    const changed = await filesChangedSince(deps.repoRoot, head);
    if (!changed) continue;
    for (const a of anchors) if (changed.has(a.path)) proofDrift.add(a.id);
  }
  return { stale, proofDrift };
}
