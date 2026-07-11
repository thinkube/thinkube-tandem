/**
 * Preliminary-control gate — a slice's `files:` must resolve *inside the
 * thinking space's own repo* (SP-th1ddy_SL-2).
 *
 * A Tandem slice declares its footprint as `files:` — the paths an
 * orchestrated worker is allowed to touch. Those paths are **repo-relative to
 * the thinking space's repo**: the worker runs from that repo's worktree root, and the
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
 * Result of checking a slice's `files:` against the thinking space repo root.
 * - `{ ok: true }` — every file is repo-relative inside the thinking space repo.
 * - `{ ok: false, offending, reason }` — at least one file escapes the repo;
 *   `offending` lists the exact declared paths (verbatim) and `reason` is a
 *   human-facing message naming them.
 */
export type SliceRepoCheck =
  | { ok: true }
  | { ok: false; offending: string[]; reason: string };

/**
 * Decide whether every entry in `files` resolves to a path **strictly inside**
 * `thinkingSpaceRepoRoot`.
 *
 * A file is *offending* when it is:
 *  - **absolute** (`/abs/path`, or any `path.isAbsolute` form) — slice files
 *    must be repo-relative, never absolute into a checkout;
 *  - **`..`-escaping** (`../sibling/x.ts`) — it resolves outside the repo root;
 *  - **a different-repo path** — i.e. it resolves outside `thinkingSpaceRepoRoot` by any
 *    route (absolute or `..`), which is the general containment failure;
 *  - **empty / non-string / the repo root itself** — not a writable repo-relative
 *    file, so rejected defensively.
 *
 * Repo-relative paths inside the thinking space repo (`src/foo.ts`, `a/b/c.md`, and
 * `./x.ts` which normalizes to `x.ts`) are accepted. The check is purely
 * lexical (no `fs`): paths are resolved against `thinkingSpaceRepoRoot` and required to
 * stay under it.
 */
/**
 * Filesystem oracle injected into {@link sliceFilesExistInRepo} so the
 * existence gate stays unit-testable (fixtures in, ok/offending out). The
 * server wires a real one (fs.existsSync + `git ls-files`).
 */
export interface RepoFileOracle {
  /** Does this repo-relative path exist in the working tree? */
  exists(repoRelPath: string): boolean;
  /** Every repo-relative tracked file (for did-you-mean); called lazily, once. */
  listFiles(): string[];
}

/**
 * Existence gate (2026-07-11, TEP-1_SP-4 post-mortem): every declared
 * footprint path must EXIST in the working repo unless the slice declares it
 * in `creates:`. The containment guard above is purely lexical, so a slice
 * could footprint a path that exists nowhere — workers then "complete" without
 * ever being able to touch the real file, and every orchestration burns on the
 * same phantom path (`backend/app/services/templates/service-configmap.yaml.j2`
 * vs the real repo-root `templates/service-configmap.yaml.j2`). Refusal names
 * each missing path with a did-you-mean basename match from the repo's tracked
 * files.
 *
 * `creates` entries are exempt (they are the slice's declared-new files);
 * held-out test-unit footprints are exempted by the CALLER (they are new by
 * design and role-tagged there).
 */
export function sliceFilesExistInRepo(
  thinkingSpaceRepoRoot: string,
  files: ReadonlyArray<string>,
  creates: ReadonlyArray<string>,
  oracle: RepoFileOracle,
): SliceRepoCheck {
  const root = path.resolve(thinkingSpaceRepoRoot);
  const declaredNew = new Set(
    (creates ?? [])
      .filter((c): c is string => typeof c === "string" && !!c.trim())
      .map((c) => path.normalize(c.trim())),
  );

  const missing: string[] = [];
  for (const raw of files ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue; // containment guard owns these
    const rel = path.normalize(raw.trim());
    if (declaredNew.has(rel)) continue;
    if (!oracle.exists(rel)) missing.push(raw);
  }
  if (missing.length === 0) return { ok: true };

  // Did-you-mean: same basename among the repo's tracked files.
  let tracked: string[] | undefined;
  const suggest = (rel: string): string => {
    tracked ??= oracle.listFiles();
    const base = path.basename(path.normalize(rel.trim()));
    const hits = tracked.filter((t) => path.basename(t) === base).slice(0, 3);
    return hits.length ? ` — did you mean ${hits.map((h) => `"${h}"`).join(" or ")}?` : "";
  };

  return {
    ok: false,
    offending: missing,
    reason:
      `Slice footprint file(s) do not exist in the thinking space repo (${root}):\n` +
      missing.map((m) => `  - "${m}"${suggest(m)}`).join("\n") +
      `\nA file this slice CREATES must be declared in \`creates:\` ` +
      `(e.g. creates: ["src/new.ts"]); every other footprint path must already ` +
      `exist, or workers are fenced onto a phantom path and every orchestration fails.`,
  };
}

export function sliceFilesResolveInRepo(
  thinkingSpaceRepoRoot: string,
  files: ReadonlyArray<string>,
): SliceRepoCheck {
  const root = path.resolve(thinkingSpaceRepoRoot);
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
        `Slice files must be repo-relative inside the thinking space repo (${root}). ` +
        `These do not resolve inside it: ${offending.join(", ")}. ` +
        `Use paths relative to the thinking space's repo root (e.g. "src/foo.ts") — ` +
        `never absolute, never "../"-escaping, never another repo's path.`,
    };
  }

  return { ok: true };
}
