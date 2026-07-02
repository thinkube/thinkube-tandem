/**
 * Slice lifecycle contract — the **single source** the `move_slice` /
 * `update_slice` handlers and their dispatch test (`src/mcp/lifecycleDispatch`)
 * agree on for two operations introduced by SP-th4wqd_SL-1:
 *
 *  1. **Retire** — `move_slice(handle, "Retired", reason)` is a *terminal* status
 *     **distinct from `Done`** that records a required `reason`. A retired slice
 *     is excluded from the active thinking space/frontier but its `SL-{m}` stays claimed
 *     on disk, so the next slice number is still `max + 1` (number reserved —
 *     ADR-0007 "archive, don't delete"). The status string the frontmatter
 *     stores is the exported `RETIRED_STATUS`; the wiring and test must both read
 *     it from here rather than re-spell the literal.
 *
 *  2. **Re-cut** — `update_slice` may *replace* a slice's footprint fields
 *     (`files` / `satisfies` / `work_units`) in place, keeping the same `SL-{m}`.
 *     A re-cut whose declared footprint escapes the thinking space repo is refused with
 *     the **same** rejection `create_slice` gives, because this helper routes
 *     through the shared `sliceFilesResolveInRepo` guard (SP-th1ddy) rather than
 *     duplicating the check.
 *
 * Pure + dependency-light (only `path`, via the reused guard, and the
 * `Frontmatter` type) so it is trivially unit-testable — shapes in, decision out,
 * no filesystem access. Persistence (read-modify-write of the slice file) stays
 * the handler's job; this module only *decides*.
 */
import type { Frontmatter } from "../store/frontmatter";
import { sliceFilesResolveInRepo } from "./sliceRepoGuard";

/**
 * The frontmatter `status:` value a retired slice carries — the canonical,
 * lowercase token (mirroring how `move_slice` normalises every status). It is a
 * **terminal** state, deliberately **not** `"done"`: a retired slice is dropped
 * from the active frontier and the → Done acceptance gate never runs for it, but
 * its number stays reserved.
 *
 * Both the handler (when extending its valid-status set and writing the file)
 * and the dispatch test (when asserting the on-disk status) MUST read this
 * constant — never the bare string — so the two can never drift.
 */
export const RETIRED_STATUS = "retired" as const;

/** The literal type of {@link RETIRED_STATUS}. */
export type RetiredStatus = typeof RETIRED_STATUS;

/** True when a (already-normalised, lowercased) status token is the retired
 *  terminal state. A tiny predicate so callers that branch on "is this a retire
 *  move" share one definition with the test. */
export function isRetiredStatus(status: string): status is RetiredStatus {
  return status.trim().toLowerCase() === RETIRED_STATUS;
}

/**
 * Outcome of validating a retire request.
 * - `{ ok: true, reason }` — `reason` is the trimmed, non-empty retire reason the
 *   handler stamps into the slice's frontmatter.
 * - `{ ok: false, error }` — `error` is the human-facing rejection the handler
 *   throws (a `Retired` move with no reason is refused).
 */
export type RetireValidation =
  | { ok: true; reason: string }
  | { ok: false; error: string };

/**
 * Validate a `move_slice(…, "Retired", reason)` request: the reason is
 * **required** (a retire must record *why*), so a missing / blank / non-string
 * reason is refused. On success the trimmed reason is returned for the handler
 * to record in frontmatter (the contract's "reason recorded" half); on failure
 * the handler throws `error` (the "no reason throws" half of the AC).
 */
export function validateRetireReason(
  reason: string | undefined | null,
): RetireValidation {
  if (typeof reason !== "string" || !reason.trim()) {
    return {
      ok: false,
      error:
        `Cannot retire a slice without a reason — pass a non-empty \`reason\` ` +
        `recording why it is being retired (a terminal state distinct from Done).`,
    };
  }
  return { ok: true, reason: reason.trim() };
}

/**
 * The footprint fields a re-cut may replace on an existing slice. Every field is
 * optional: an **omitted** field is left untouched; a **provided** field
 * (including an empty array) *replaces* the existing value wholesale. This is the
 * exact shape `update_slice` accepts and the dispatch test drives.
 */
export interface SliceRecut {
  /** New machine-readable footprint — repo-relative paths. Replaces `files`. */
  files?: string[];
  /** New 1-based AC ordinals the slice delivers. Replaces `satisfies`. */
  satisfies?: number[];
  /** New execution-aware work units. Replaces `work_units`. */
  work_units?: Frontmatter["work_units"];
  /** New design-time contract (SP-6/3 — the shared interface every worker builds against).
   *  Replaces `contract`; a re-scope that changes the seam must be able to revise it. */
  contract?: string;
}

/** True when a re-cut carries at least one footprint field to replace. */
export function hasRecutFields(recut: SliceRecut | undefined): boolean {
  if (!recut) return false;
  return (
    recut.files !== undefined ||
    recut.satisfies !== undefined ||
    recut.work_units !== undefined ||
    recut.contract !== undefined
  );
}

/**
 * Outcome of applying a re-cut to a slice's frontmatter.
 * - `{ ok: true, frontmatter }` — the next frontmatter, with the provided
 *   footprint fields replaced and **every other field preserved** (so `uid`,
 *   `status`, `parent`, tags … and therefore the slice's `SL-{m}` identity are
 *   untouched). The handler writes this back to the *same* slice path.
 * - `{ ok: false, error, offending }` — the re-cut's declared footprint escapes
 *   the thinking space repo; `error` is the shared `sliceFilesResolveInRepo` rejection and
 *   `offending` lists the exact paths, so the handler refuses it identically to
 *   `create_slice`.
 */
export type RecutResult =
  | { ok: true; frontmatter: Frontmatter }
  | { ok: false; error: string; offending: string[] };

/**
 * Apply a re-cut to a slice's existing frontmatter, routing the declared
 * footprint through the **shared** `sliceFilesResolveInRepo` guard (SP-th1ddy) —
 * not a copy — so a re-scope is refused on exactly the same repo-escape grounds
 * `create_slice` refuses a fresh slice. Like create, **both** `files:` and every
 * `work_units[].footprint` are footprints and so are checked together.
 *
 * Provided fields replace; omitted fields are left as they were. The slice's
 * number / identity lives in the file path, not these fields, so replacing them
 * preserves `SL-{m}`.
 *
 * @param thinkingSpaceRepoRoot Absolute path to the thinking space's repo root (the worktree the
 *   orchestrated worker runs from) — what footprints must stay inside.
 * @param existing The slice's current frontmatter (or undefined for a bare file).
 * @param recut The footprint fields to replace.
 */
export function recutSliceFrontmatter(
  thinkingSpaceRepoRoot: string,
  existing: Frontmatter | undefined,
  recut: SliceRecut,
): RecutResult {
  // Collect every declared footprint path the same way `create_slice` does:
  // `files:` plus each work-unit `footprint`. Only the *provided* fields
  // contribute — an omitted field keeps the slice's current footprint, which was
  // already validated when it was last written.
  const declaredFiles: string[] = [
    ...(recut.files ?? []),
    ...(recut.work_units ?? []).flatMap((wu) => wu?.footprint ?? []),
  ];
  if (declaredFiles.length) {
    const check = sliceFilesResolveInRepo(thinkingSpaceRepoRoot, declaredFiles);
    if (!check.ok) {
      return { ok: false, error: check.reason, offending: check.offending };
    }
  }

  // Replace only the provided fields; preserve everything else (uid, status,
  // parent, tags, …) so the slice keeps its identity and `SL-{m}`.
  const next: Frontmatter = { ...(existing ?? {}) };
  if (recut.files !== undefined) next.files = recut.files;
  if (recut.satisfies !== undefined) next.satisfies = recut.satisfies;
  if (recut.work_units !== undefined) next.work_units = recut.work_units;
  if (recut.contract !== undefined) next.contract = recut.contract;

  return { ok: true, frontmatter: next };
}
