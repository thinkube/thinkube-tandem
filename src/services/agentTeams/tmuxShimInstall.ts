/**
 * PATH install + takeover policy for the fake-`tmux` shim (SP-tgnb5o_SL-2, AC#5).
 *
 * Unlike the `claude` cwd-wrapper (which the host extension finds via the
 * `claudeCode.claudeProcessWrapper` setting), Claude Code locates `tmux` by
 * PATH. So to make agent teams use our shim we prepend the wrapper directory
 * (which contains `tmux`) to the Extension Host's `process.env.PATH`; the
 * `claude` process spawned by claude-vscode inherits it, exactly as it inherits
 * `THINKUBE_TMUX_SHIM_SOCK` / `CLAUDE_CWD_PROXY_DIR`.
 *
 * Takeover policy mirrors LauncherService: install when the slot is free or
 * already ours; an unknown third-party `tmux` already on PATH is NOT clobbered
 * without a one-time confirmation. The decision is a pure function so it's
 * unit-testable without touching PATH or the filesystem.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type TmuxTakeover =
  | "already-installed"
  | "install"
  | "needs-confirmation"
  | "skip";

/**
 * Decide what to do about our shim given the current PATH, our shim dir, and
 * the directory of any `tmux` already resolvable on PATH (null if none).
 */
export function decideTmuxTakeover(args: {
  pathEntries: string[];
  shimDir: string;
  existingTmuxDir: string | null;
}): TmuxTakeover {
  const { pathEntries, shimDir, existingTmuxDir } = args;
  // Already at the front → nothing to do.
  if (pathEntries[0] === shimDir) return "already-installed";
  // No competing tmux anywhere, or the only one found is ours → safe to install.
  if (existingTmuxDir === null || existingTmuxDir === shimDir) return "install";
  // A third-party tmux is on PATH ahead of us — don't displace it silently.
  return "needs-confirmation";
}

/** Split a PATH string into entries (platform-aware delimiter). */
export function splitPath(
  pathVar: string | undefined,
  delimiter: string = path.delimiter,
): string[] {
  if (!pathVar) return [];
  return pathVar.split(delimiter).filter((e) => e.length > 0);
}

/**
 * Find the directory of the first `tmux` executable on PATH, excluding our own
 * shim dir. Returns null when none is found. Pure-ish: takes the PATH entries
 * and an existence probe so it can be unit-tested with a fake.
 */
export function findExistingTmuxDir(
  pathEntries: string[],
  shimDir: string,
  exists: (p: string) => boolean,
  exeNames: string[] = process.platform === "win32"
    ? ["tmux.exe", "tmux.cmd", "tmux"]
    : ["tmux"],
): string | null {
  for (const dir of pathEntries) {
    if (dir === shimDir) continue;
    for (const name of exeNames) {
      if (exists(path.join(dir, name))) return dir;
    }
  }
  return null;
}

/** Prepend `shimDir` to a PATH string (no-op if already at the front). */
export function prependToPath(
  pathVar: string | undefined,
  shimDir: string,
  delimiter: string = path.delimiter,
): string {
  const entries = splitPath(pathVar, delimiter);
  if (entries[0] === shimDir) return entries.join(delimiter);
  return [shimDir, ...entries.filter((e) => e !== shimDir)].join(delimiter);
}

/** Default executable-existence probe used by the live installer. */
export function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
