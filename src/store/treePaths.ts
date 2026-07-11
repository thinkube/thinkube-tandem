/**
 * treePaths — pure, vscode-free builders for the nested thinking space tree
 *.
 *
 * The org-scoped sequential-id layout stores every artifact as a tree rooted at
 * a thinking space, namespaced by a per-maintainer organization segment:
 *
 *   <org>/teps/TEP-n/tep.md            the TEP document
 *   <org>/teps/TEP-n/SP-m/spec.md      a spec under that TEP
 *   <org>/teps/TEP-n/SP-m/SL-k.md      a slice under that spec
 *
 * These builders return the thinking space-RELATIVE path (the `<org>/teps/…` part); the
 * caller (`ThinkubeStore`, via `thinkingSpaceDirForNamespace`) joins it onto the thinking space
 * root to get `<thinking space>/<org>/teps/…`. The path logic is kept out of
 * `ThinkubeStore.ts` (which imports `vscode`) so it runs under `node --test`,
 * and the `<org>` segment is an argument — the builders don't know or care
 * where the org comes from (its resolver lives beside `containerSegment`).
 *
 * Pure (string-only, no `vscode`/`fs`): thinking space-relative keys are always
 * forward-slashed so they stay stable across platforms (modeled on
 * `thinkingSpaceDirForNamespace`).
 */

/** `<org>/teps` — the TEP root for an org under a thinking space. */
export function tepsRoot(org: string): string {
  return `${org}/teps`;
}

/** `<org>/teps/TEP-n` — a TEP's folder. */
export function tepDir(org: string, tep: number): string {
  return `${tepsRoot(org)}/TEP-${tep}`;
}

/** `<org>/teps/TEP-n/tep.md` — a TEP's document. */
export function tepDoc(org: string, tep: number): string {
  return `${tepDir(org, tep)}/tep.md`;
}

/** `<org>/teps/TEP-n/SP-m` — a spec's folder under its TEP. */
export function specDir(org: string, tep: number, spec: number): string {
  return `${tepDir(org, tep)}/SP-${spec}`;
}

/** `<org>/teps/TEP-n/SP-m/spec.md` — a spec's document. */
export function specDoc(org: string, tep: number, spec: number): string {
  return `${specDir(org, tep, spec)}/spec.md`;
}

/** `<org>/teps/TEP-n/SP-m/SL-k.md` — a slice file under its spec. */
export function slicePath(
  org: string,
  tep: number,
  spec: number,
  slice: number,
): string {
  return `${specDir(org, tep, spec)}/SL-${slice}.md`;
}

/**
 * The canonical tep-qualified slice handle, e.g. `TEP-1_SP-1_SL-1`. With bare
 * scope-local ids the `SP-m` number alone repeats across TEPs, so the handle
 * leads with the `TEP-n` segment to stay globally unique within a thinking space — that
 * uniqueness is what lets cross-spec `depends_on`, git branches, and worktrees
 * key off the handle without collisions.
 */
export function sliceHandle(tep: number, spec: number, slice: number): string {
  return `TEP-${tep}_SP-${spec}_SL-${slice}`;
}
