/**
 * Qualified `implements:` references (SP-tgvpbm / TEP-tgvh8p) — the membership
 * engine for the structural Project model.
 *
 * A Spec's `implements:` is either:
 *   - **bare** `TEP-id` / `id` → the TEP in the spec's OWN board (repo-local;
 *     unchanged, backward-compatible), or
 *   - **qualified** `<namespace>:TEP-id` → the TEP owned by `<namespace>` (a
 *     repo board `<container>/<rel>` or a project `<product>/projects/<name>`),
 *     resolving across boards.
 *
 * Pure (no vscode/fs) so it's unit-testable vscode-free. A spec is a member of a
 * project iff its `implements:` resolves to one of the project's umbrella TEPs —
 * which a bare ref can never do (its owner is the spec's own repo, not a
 * project), so cross-repo membership always goes through a qualified ref.
 */

export interface ParsedImplements {
  /** Owner namespace when qualified; undefined ⇒ the spec's own board (bare). */
  namespace?: string;
  /** Bare TEP id (no `TEP-` prefix). */
  id: string;
}

/** Strip an optional `TEP-` prefix and trim. */
export function normalizeTepId(raw: string): string {
  return raw.trim().replace(/^TEP-/i, "");
}

/**
 * Parse an `implements:` value. Splits on the LAST `:` (a namespace is a
 * `/`-path and a TEP id has no `:`), so `<ns>:TEP-id` → namespace + id and a
 * bare `TEP-id` → just id. Empty/whitespace → undefined.
 */
export function parseImplements(raw: string | undefined): ParsedImplements | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    return { namespace: s.slice(0, idx).trim(), id: normalizeTepId(s.slice(idx + 1)) };
  }
  return { id: normalizeTepId(s) };
}

/** Serialize a (namespace, id) into an `implements:` value (`TEP-` re-added). */
export function formatImplements(
  namespace: string | undefined,
  id: string,
): string {
  const tep = `TEP-${normalizeTepId(id)}`;
  return namespace ? `${namespace}:${tep}` : tep;
}

/**
 * Does a spec's parsed `implements:` (the spec lives in `specNamespace`) resolve
 * to the TEP `targetId` owned by `targetNamespace`? A bare ref resolves to the
 * spec's own board; a qualified ref to its explicit namespace.
 */
export function resolvesTo(
  ref: ParsedImplements,
  specNamespace: string,
  targetNamespace: string,
  targetId: string,
): boolean {
  if (normalizeTepId(ref.id) !== normalizeTepId(targetId)) return false;
  const owner = ref.namespace ?? specNamespace;
  return owner === targetNamespace;
}

/**
 * The decision for `promote_tep` (SP-tgvpbm_SL-3): given a spec (in
 * `specNamespace`) whose `implements:` is `implementsRaw`, and a TEP `tepId`
 * being moved out of `originNamespace` into `projectNamespace`, return the
 * spec's NEW `implements:` value if it depended on that TEP, else `null`.
 * A dependent is any spec that resolved to the TEP at its origin (a bare ref in
 * the origin repo, or a ref qualified to the origin namespace). The rewrite is
 * always the qualified umbrella ref — so no bare/dangling ref to the moved TEP
 * can remain.
 */
export function rewriteImplementsForPromote(
  specNamespace: string,
  implementsRaw: string | undefined,
  originNamespace: string,
  tepId: string,
  projectNamespace: string,
): string | null {
  const ref = parseImplements(implementsRaw);
  if (!ref || !resolvesTo(ref, specNamespace, originNamespace, tepId)) {
    return null;
  }
  return formatImplements(projectNamespace, tepId);
}
