/**
 * The one rule for what counts as documentation: a repo-relative path
 * under `docs/`. The run's docs gate (`src/run/plan.ts`) and the sign
 * gate (`src/gates/sign.ts`) both read this rule from here so they can
 * never drift apart on what a "doc path" is.
 *
 * A third copy lives at `src/engine/core/redispatch.ts` — its own
 * `docs/`-prefix test, kept as imported speech (recorded, not read) for
 * the orchestrated → Done path. It is deliberately not folded into this
 * module; it stays where it is until that path is re-plumbed to import
 * this rule directly.
 */
import type { Cut, Space } from "./schema";

/** True for a repo-relative path that lands under the docs tree. */
export function isDocPath(path: string): boolean {
  return path.startsWith("docs/");
}

/** The documentation paths a cut's grounded members land, deduplicated. */
export function docLandings(space: Space, cut: Cut): string[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const paths = new Set<string>();
  for (const id of cut.changeIds) {
    const n = byId.get(id);
    for (const t of n?.grounding?.touchpoints ?? []) if (isDocPath(t.path)) paths.add(t.path);
  }
  return [...paths];
}
