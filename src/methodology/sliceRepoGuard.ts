/**
 * Preliminary-control gate — a slice's `files:` must resolve *inside the
 * board's own repo* (SP-th1ddy_SL-2).
 *
 * A Tandem slice declares its footprint as `files:` — the paths an
 * orchestrated worker is allowed to touch. Those paths are **repo-relative to
 * the board's repo**: the worker runs from that repo's worktree root, and the
 * ownership guard (`footprintGuard` in `parallelSlices.ts`) compares writes
 * against the same repo-relative set. A slice whose `files:` point *outside*
 * that repo — an absolute path into some other checkout, a `..`-escaping path,
 * or a path under a different repo root — is structurally invalid: the worker
 * could never legally write them, and the slice fails orchestration *after* a
 * run is already burned. (This is exactly what happened to the cross-repo slice
 * that motivated this spec.)
 *
 * This guard moves that check **to creation / →Ready**: `create_slice` calls
 * `sliceFilesResolveInRepo` and refuses a structurally-broken slice up front,
 * naming the offending path so the author fixes it before any orchestration.
 *
 * Pure + dependency-light (only Node's `path`) so it is trivially testable —
 * fixtures in, ok/offending out, no filesystem access.
 */
import * as path from "path";

/**
 * Result of checking a slice's `files:` against the board repo root.
 * - `{ ok: true }` — every file is repo-relative inside the board repo.
 * - `{ ok: false, offending, reason }` — at least one file escapes the repo;
 *   `offending` lists the exact declared paths (verbatim) and `reason` is a
 *   human-facing message naming them.
 */
export type SliceRepoCheck =
  | { ok: true }
  | { ok: false; offending: string[]; reason: string };

/**
 * Decide whether every entry in `files` resolves to a path **strictly inside**
 * `boardRepoRoot`.
 *
 * A file is *offending* when it is:
 *  - **absolute** (`/abs/path`, or any `path.isAbsolute` form) — slice files
 *    must be repo-relative, never absolute into a checkout;
 *  - **`..`-escaping** (`../sibling/x.ts`) — it resolves outside the repo root;
 *  - **a different-repo path** — i.e. it resolves outside `boardRepoRoot` by any
 *    route (absolute or `..`), which is the general containment failure;
 *  - **empty / non-string / the repo root itself** — not a writable repo-relative
 *    file, so rejected defensively.
 *
 * Repo-relative paths inside the board repo (`src/foo.ts`, `a/b/c.md`, and
 * `./x.ts` which normalizes to `x.ts`) are accepted. The check is purely
 * lexical (no `fs`): paths are resolved against `boardRepoRoot` and required to
 * stay under it.
 */
export function sliceFilesResolveInRepo(
  boardRepoRoot: string,
  files: ReadonlyArray<string>,
): SliceRepoCheck {
  const root = path.resolve(boardRepoRoot);
  const offending: string[] = [];

  for (const raw of files ?? []) {
    if (typeof raw !== "string" || !raw.trim()) {
      // No usable path — treat the verbatim value as offending.
      offending.push(String(raw));
      continue;
    }
    const file = raw.trim();

    // Absolute paths are never valid slice footprints, even if they happen to
    // point inside the repo — slice files must be declared repo-relative.
    if (path.isAbsolute(file)) {
      offending.push(raw);
      continue;
    }

    // Resolve the repo-relative path and require it to stay strictly under root.
    // `path.relative` yields a leading `..` (or an absolute path on a drive
    // change) when the target escapes root; an empty string means the path *is*
    // the repo root, which is a directory, not a writable file.
    const resolved = path.resolve(root, file);
    const rel = path.relative(root, resolved);
    if (
      rel === "" ||
      rel === ".." ||
      rel.startsWith(".." + path.sep) ||
      path.isAbsolute(rel)
    ) {
      offending.push(raw);
      continue;
    }
  }

  if (offending.length > 0) {
    return {
      ok: false,
      offending,
      reason:
        `Slice files must be repo-relative inside the board repo (${root}). ` +
        `These do not resolve inside it: ${offending.join(", ")}. ` +
        `Use paths relative to the board's repo root (e.g. "src/foo.ts") — ` +
        `never absolute, never "../"-escaping, never another repo's path.`,
    };
  }

  return { ok: true };
}
