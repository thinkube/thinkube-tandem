/**
 * What the machine refuses before it dispatches anybody.
 *
 * Every expensive failure of the worst week was decided before a worker
 * started and discovered an hour into the run: a promise whose only
 * implementation site sat in another unit's clearance, a promise reaching
 * into two repositories, a plan that left the seam between its parts for
 * the last gate to find.
 *
 * A refusal here costs one reading of one sentence, at a moment when the
 * plan is the only thing that exists. The same fault found during the run
 * costs an hour and a person's attention, which is the number this whole
 * design is judged by.
 *
 * Each refusal names the PROMISE, in the person's own words — never a file,
 * a unit, or an internal of the run.
 */
import type { SliceForDag } from "../engine/core/dag";
import type { Change, Space } from "../core/schema";
import { isTestPath } from "./testHomes";

interface SliceLike extends SliceForDag {
  criterionIds?: string[];
}

/** The promises a slice is responsible for, from the criteria it carries. */
function promisesOf(slice: SliceLike, space: Space): Change[] {
  const ids = new Set(slice.criterionIds ?? []);
  return space.nodes.filter((n) => n.acceptance.some((a) => ids.has(a.id)));
}

/** What a slice's code units are cleared to write — production only. */
function clearanceOf(slice: SliceForDag): string[] {
  return slice.workUnits
    .filter((u) => (u.role ?? "code") !== "test")
    .flatMap((u) => u.footprint)
    .filter((p) => !isTestPath(p));
}

/**
 * The refusals, in the order a reader would want them: what cannot be
 * built at all, then what cannot be proven, then what is merely ordered
 * badly.
 *
 * Returns one sentence per refusal, or nothing when the plan can run.
 */
export function refusalsBeforeDispatch(a: {
  slices: SliceForDag[];
  space: Space;
}): string[] {
  const out: string[] = [];
  const slices = a.slices as SliceLike[];

  for (const s of slices) {
    const cleared = clearanceOf(s);
    for (const promise of promisesOf(s, a.space)) {
      // A promise that reaches into two repositories cannot be delivered by
      // one run: each repository has its own branch and its own delivery.
      const scopes = [
        ...new Set(
          (promise.grounding?.touchpoints ?? [])
            .map((t) => t.scope ?? "")
            .filter(Boolean),
        ),
      ];
      if (scopes.length > 1)
        out.push(
          `"${promise.sentence}" lands in more than one repository (${scopes.join(", ")}). ` +
            `A promise belongs to one repository, because each one is delivered on its own branch and accepted on its own. ` +
            `Split it into one promise per repository.`,
        );

      // The site a promise names must be inside the clearance of the unit
      // responsible for it. Otherwise the unit is asked to keep a promise
      // it cannot reach, and discovers it four rounds in.
      // Every place the promise lands, minus the files its slice only
      // READS — a declared read is not a site, and needs no clearance.
      const reads = new Set(
        s.workUnits.flatMap((u) => [
          ...((u as { reads?: string[] }).reads ?? []),
          ...((u as { consumes?: string[] }).consumes ?? []),
        ]),
      );
      const sites = (promise.grounding?.touchpoints ?? [])
        .map((t) => t.path)
        .filter((p) => !isTestPath(p) && !reads.has(p));
      const unreachable = sites.filter(
        (p) => !cleared.some((c) => c === p || p.startsWith(c.replace(/\/$/, "") + "/")),
      );
      if (sites.length && unreachable.length === sites.length)
        out.push(
          `"${promise.sentence}" is to be kept by work that may not change ${unreachable.join(", ")} — the only place it lands. ` +
            `The unit responsible for a promise must be cleared to change where the promise lands.`,
        );
    }
  }
  return out;
}

/**
 * The order the slices run in, with a thin end-to-end path first.
 *
 * A plan that builds every part and joins them at the end discovers at the
 * last gate whether the parts fit — the most expensive moment there is. A
 * slice that touches the product's outer seam goes first, so the join is
 * exercised while everything after it can still be shaped by what it found.
 *
 * "Outer seam" is read from the plan, not guessed: the files a slice lands
 * in that nothing else in the plan depends on being built first — the ones
 * a person reaches the product through.
 */
export function skeletonFirst(slices: SliceForDag[], entryPoints: readonly string[]): SliceForDag[] {
  if (!entryPoints.length || slices.length < 2) return slices;
  const touchesSeam = (s: SliceForDag): boolean =>
    s.workUnits.some((u) => u.footprint.some((f) => entryPoints.some((e) => f === e || f.startsWith(e))));
  const first = slices.findIndex(touchesSeam);
  if (first <= 0) return slices;
  const s = slices[first];
  // A maintain slice follows its parent; moving one would orphan it.
  if ((s as { maintains?: string }).maintains) return slices;
  return [s, ...slices.filter((x) => x !== s)];
}
