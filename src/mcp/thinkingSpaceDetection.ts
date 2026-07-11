/**
 * thinkingSpaceDetection — what counts as a Tandem thinking space on disk (TEP-0008).
 *
 * A directory is a thinking space iff it is **thinking space-shaped**: its thinking space dir contains a
 * `specs/` subdir. Enabling a thinking space always scaffolds `specs/`, `decisions/`,
 * and `retros/` (`commands/thinkingSpaces.ts`), so every real thinking space — sidecar
 * namespace or legacy co-located `<repo>/.thinkube` — has `specs/`. A directory
 * that merely happens to contain a `.thinkube/` for some other purpose (e.g.
 * an `api-token` store at `~/.thinkube`) is NOT a thinking space.
 *
 * This is the guard that stops a stray `.thinkube/` from being mistaken for a
 * co-located thinking space and adopted as the session default — the silent fallback
 * TEP-0008 set out to remove. Kept fs-only (no `vscode`, no server import) so
 * it is unit-testable without booting the MCP server.
 */
import * as fsSync from "node:fs";
import * as path from "node:path";

/** The methodology dirs that mark an *enabled* thinking space (`enableHere` scaffolds
 *  `specs`/`decisions`/`retros`; `teps` arrives with the first TEP). Any one of
 *  them — flat (legacy) or under an `<org>/` segment (the org-scoped tree) —
 *  means this is a thinking space, even one with no TEPs yet. */
const THINKING_SPACE_MARKERS = ["teps", "specs", "decisions", "retros"];

/** True iff `thinkingSpaceDir` is thinking space-shaped: a legacy flat methodology dir at its
 *  root, OR — under the org-scoped tree — an immediate `<org>/`
 *  child that holds one (so an enabled-but-empty thinking space still counts). */
export function isThinkingSpaceDir(thinkingSpaceDir: string): boolean {
  const hasSubdir = (dir: string, name: string): boolean => {
    try {
      return fsSync.statSync(path.join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  };
  if (THINKING_SPACE_MARKERS.some((m) => hasSubdir(thinkingSpaceDir, m))) return true;
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(thinkingSpaceDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules")
      continue;
    if (THINKING_SPACE_MARKERS.some((m) => hasSubdir(path.join(thinkingSpaceDir, e.name), m)))
      return true;
  }
  return false;
}
