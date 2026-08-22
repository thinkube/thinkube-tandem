/**
 * One rule for what counts as documentation: a repo-relative path under
 * `docs/`. Both the sign gate (src/gates/sign.ts) and the run's docs gate
 * (src/run/plan.ts) read this rule from here, so a cut and a slice can
 * never disagree on what a documentation path is.
 *
 * The engine's redispatch module (src/engine/core/redispatch.ts,
 * `unmetDocsObligation`) carries its own copy of this same test. It is
 * engine-imported speech — pinned by the split-fidelity manifest — and is
 * deliberately not folded into this module; it stays a second, independent
 * reading of the same rule rather than a caller of it.
 */
import type { Cut, Space } from "./schema";

/** True when `path` is a repo-relative path under the `docs/` tree. */
export function isDocPath(path: string): boolean {
  return path.startsWith("docs/");
}

/** The documentation paths a cut's grounded members actually land, drawn
 *  from each member's touchpoint anchors. Duplicate paths across members
 *  are reported once. */
export function docLandings(space: Space, cut: Cut): string[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const paths = new Set<string>();
  for (const id of cut.changeIds) {
    const n = byId.get(id);
    for (const a of n?.grounding?.touchpoints ?? []) {
      if (isDocPath(a.path)) paths.add(a.path);
    }
  }
  return [...paths];
}
