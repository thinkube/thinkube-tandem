/**
 * The naming pass over a space (SPEC: units get titles; two faces, one
 * source): find every unit whose render is missing or describes a member
 * set that has since moved, name them in one batched judgment round, and
 * stamp the results. Fail-soft — an unnamed unit keeps its fallback title
 * (the first member sentence) on the surface.
 */
import { Space } from "../core/schema";
import { SourceStamp } from "../core/stamp";
import { RoundDeps } from "../derive/round";
import { nameUnits } from "../derive/name";

export interface NamingPassDeps {
  space: Space;
  round: RoundDeps;
  name: typeof nameUnits;
  readStamps: () => Promise<SourceStamp[]>;
  /** Liveness for the surface; called with undefined when the pass ends. */
  onActivity: (
    a: { label: string; current: number; total: number } | undefined,
  ) => void;
}

/** How many units one naming round carries — small enough that the reply
 *  names every one of them. */
export const NAMING_BATCH = 8;

/** One pass; resolves the named abstracts keyed by unit id (with the
 *  member set each describes), or undefined when nothing was due or the
 *  round named nothing. The CALLER merges into its current space — a
 *  long round must never replace state with a copy of its past. */
export async function renderUnitAbstracts(
  deps: NamingPassDeps,
): Promise<Map<string, { title: string; text?: string; stamp: SourceStamp[]; of: string[] }> | undefined> {
  const { space } = deps;
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const key = (ids: readonly string[]) => [...ids].sort().join(",");
  const due = space.units.filter(
    (u) => !u.abstract || key(u.abstract.of ?? []) !== key(u.changeIds),
  );
  if (due.length === 0) return undefined;
  // Membership may move while the round runs; the render is OF this
  // snapshot, so a mid-round move leaves it stale and due again.
  const describedSet = new Map(due.map((u) => [u.id, [...u.changeIds]]));
  // One prompt carrying every unit loses some in the reply; naming runs in
  // small batches instead, so a big space comes back fully named.
  const asked = due.map((u) => ({
    id: u.id,
    sentences: u.changeIds.map((id) => byId.get(id)?.sentence ?? id),
  }));
  const batches: (typeof asked)[] = [];
  for (let i = 0; i < asked.length; i += NAMING_BATCH)
    batches.push(asked.slice(i, i + NAMING_BATCH));
  let done = 0;
  deps.onActivity({ label: "naming the units of work", current: 0, total: batches.length });
  const named = (
    await Promise.all(
      batches.map((b) =>
        deps
          .name(deps.round, b)
          .catch(() => [])
          .then((r) => {
            deps.onActivity({
              label: "naming the units of work",
              current: ++done,
              total: batches.length,
            });
            return r;
          }),
      ),
    )
  ).flat();
  deps.onActivity(undefined);
  if (named.length === 0) return undefined;
  const stamp = await deps.readStamps().catch(() => [] as SourceStamp[]);
  const out = new Map<string, { title: string; text?: string; stamp: SourceStamp[]; of: string[] }>();
  for (const nm of named) {
    const of = describedSet.get(nm.unitId);
    if (of) out.set(nm.unitId, { title: nm.title, ...(nm.text ? { text: nm.text } : {}), stamp, of });
  }
  return out;
}

/** SPEC: re-name units whose question was since decided — drop the render
 *  of every unit with a member serving the decided question's ask. */
export function clearAbstractsServingAsk(space: Space, askId: string): Space {
  const serving = new Set(
    space.nodes.filter((n) => n.serves.includes(askId)).map((n) => n.id),
  );
  return {
    ...space,
    units: space.units.map((u) =>
      u.abstract && u.changeIds.some((id) => serving.has(id))
        ? { ...u, abstract: undefined }
        : u,
    ),
  };
}
