/**
 * thinkingSpaceNamespace — map a Thinking Space (a repo under a workspace folder) to
 * its namespace under the central thinking space root, and back (SP-8 / ADR-0008).
 *
 * A thinking space namespace is `<container>/<rel>`:
 *   - **container**: the workspace folder the repo lives under, filesystem-safe
 *     (e.g. "Apps", "User-Templates", "Platform"). It carries semantic meaning
 *     (what kind of Thinking Space, and implicitly which host) and is
 *     deploy-standardized via `thinkube.code-workspace`.
 *   - **rel**: the repo's path relative to that folder, forward-slashed.
 *
 * The namespace is **host-agnostic** — Thinking Spaces span git hosts (Apps on
 * the user's Gitea, Platform/User-Templates on GitHub), so identity must never
 * derive from a git remote. The workspace-relative path is the stable,
 * host-neutral key.
 *
 * Pure (path-only, no `vscode`/`fs`) so both the navigator (extension) and the
 * MCP server (subprocess) can share it; each side supplies its folder list. The
 * lone exception is `gitUserName` — the thin, impure caller that reads git
 * `user.name` as the org source; the pure `resolveOrg` it feeds stays
 * git-free and unit-testable.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

export interface WorkspaceFolderRef {
  /** Workspace folder display name (e.g. "Apps", "User Templates"). */
  name: string;
  /** Absolute filesystem path of the folder. */
  path: string;
}

/** Filesystem-safe container segment from a workspace folder name. */
export function containerSegment(folderName: string): string {
  return folderName
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/\s+/g, "-");
}

/**
 * The per-maintainer **organization segment** — the
 * directory that namespaces the sequential ids (`<thinking space>/<org>/teps/TEP-n/…`) so
 * concurrent maintainers on one thinking space never collide. It is DERIVED from git
 * `user.name`, sanitized into a filesystem-safe segment with the same
 * `containerSegment` convention (single source of sanitization).
 *
 * There is **no default and no `tandem.org` setting**: an unset / empty /
 * whitespace-only name throws a clear error, so every operation that needs the
 * org fails fast at the boundary rather than silently writing under a fallback.
 *
 * Pure — the caller supplies the name string, so this is unit-testable without
 * spawning git or depending on ambient git state. The `git config user.name`
 * read lives in the thin {@link gitUserName} caller.
 */
export function resolveOrg(userName: string | undefined): string {
  const trimmed = (userName ?? "").trim();
  if (!trimmed) {
    throw new Error(
      "Cannot resolve the organization segment: git `user.name` is unset or " +
        'empty. Set it with `git config user.name "Your Name"` — there is no ' +
        "default organization (org-scoped sequential ids are namespaced per " +
        "maintainer).",
    );
  }
  return containerSegment(trimmed);
}

/**
 * Thin, impure caller: read git `user.name` (the org source for
 * {@link resolveOrg}). Returns the trimmed name, or `undefined` when git has no
 * `user.name` configured — or git is unavailable — so `resolveOrg` turns that
 * into its fail-fast error. Kept separate from `resolveOrg` so the resolver
 * stays pure and git-free under `node --test`.
 */
export function gitUserName(cwd?: string): string | undefined {
  try {
    const out = execFileSync("git", ["config", "user.name"], {
      cwd,
      encoding: "utf8",
    });
    const name = out.trim();
    return name === "" ? undefined : name;
  } catch {
    return undefined;
  }
}

/** Forward-slash an OS path so namespaces are stable across platforms. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** True when `target` is `base` or lives beneath it. */
function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The deepest workspace folder enclosing `repoPath`, or undefined when no
 * folder contains it. Deepest wins so nested folders resolve correctly.
 */
function enclosingFolder(
  repoPath: string,
  folders: WorkspaceFolderRef[],
): WorkspaceFolderRef | undefined {
  const target = path.resolve(repoPath);
  let best: WorkspaceFolderRef | undefined;
  for (const f of folders) {
    const base = path.resolve(f.path);
    if (isInside(base, target)) {
      if (!best || base.length > path.resolve(best.path).length) best = f;
    }
  }
  return best;
}

/**
 * Namespace `<container>/<rel>` for a repo, or undefined if it isn't under any
 * workspace folder. A repo that *is* a workspace folder yields just
 * `<container>`.
 */
export function namespaceForRepo(
  repoPath: string,
  folders: WorkspaceFolderRef[],
): string | undefined {
  const folder = enclosingFolder(repoPath, folders);
  if (!folder) return undefined;
  const container = containerSegment(folder.name);
  const rel = toPosix(
    path.relative(path.resolve(folder.path), path.resolve(repoPath)),
  );
  return rel === "" ? container : `${container}/${rel}`;
}

/** Absolute thinking space dir for a namespace under the thinking space root. */
export function thinkingSpaceDirForNamespace(
  thinkingSpaceRoot: string,
  namespace: string,
): string {
  return path.join(thinkingSpaceRoot, ...namespace.split("/"));
}

/**
 * The repo path a namespace maps back to, or undefined if its container
 * doesn't match any workspace folder. Inverse of `namespaceForRepo`.
 */
export function repoPathForNamespace(
  namespace: string,
  folders: WorkspaceFolderRef[],
): string | undefined {
  const segs = namespace.split("/").filter(Boolean);
  if (segs.length === 0) return undefined;
  const [container, ...rel] = segs;
  const folder = folders.find((f) => containerSegment(f.name) === container);
  if (!folder) return undefined;
  return rel.length
    ? path.join(folder.path, ...rel)
    : path.resolve(folder.path);
}
