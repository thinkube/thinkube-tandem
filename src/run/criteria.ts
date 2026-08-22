/**
 * Which criterion a check proves.
 *
 * A check is born as `probes/<space>__SL-n_AC-k.test.mjs` — filed under the
 * event that produced it, never under the code it drives. These two
 * functions are the map back: from a check's path to the criterion whose
 * words it was written from, and from a criterion to the check that proved
 * it. The gate needs the first to label its proofs and to record the check
 * on the delivery; the dispatcher needs the second to tell a unit which of
 * its promises a red belongs to.
 */
import type { SliceForDag } from "../engine/core/dag";
import type { Space } from "../core/schema";




/** Probe path → the criterion it proves, from the adapter's bookkeeping. */
export function criterionMapOf(slices: SliceForDag[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of slices) {
    const ids = (s as { criterionIds?: string[] }).criterionIds ?? [];
    s.workUnits
      .filter((u) => u.role === "test")
      .forEach((u, k) => {
        if (ids[k]) map.set(u.footprint[0], ids[k]);
      });
  }
  return map;
}



/** The check behind a slice's ordinal, resolved from the space — the
 *  probe never carries delivery bookkeeping. */
export function criterionLookup(
  slices: SliceForDag[],
  space: Space,
): (slice: string, ac: number) => { id: string; text: string } | undefined {
  return (slice, ac) => {
    const ids = (slices.find((x) => x.handle === slice) as { criterionIds?: string[] })
      ?.criterionIds;
    const id = ids?.[ac - 1];
    if (!id) return undefined;
    for (const n of space.nodes) {
      const c = n.acceptance.find((a) => a.id === id);
      if (c) return { id, text: c.text };
    }
    return undefined;
  };
}
