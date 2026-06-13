/**
 * boardDetection — what counts as a Tandem board on disk (TEP-tghb9t / TEP-0008).
 *
 * A directory is a board iff it is **board-shaped**: its board dir contains a
 * `specs/` subdir. Enabling a board always scaffolds `specs/`, `decisions/`,
 * and `retros/` (`commands/boards.ts`), so every real board — sidecar
 * namespace or legacy co-located `<repo>/.thinkube` — has `specs/`. A directory
 * that merely happens to contain a `.thinkube/` for some other purpose (e.g.
 * an `api-token` store at `~/.thinkube`) is NOT a board.
 *
 * This is the guard that stops a stray `.thinkube/` from being mistaken for a
 * co-located board and adopted as the session default — the silent fallback
 * TEP-0008 set out to remove. Kept fs-only (no `vscode`, no server import) so
 * it is unit-testable without booting the MCP server.
 */
import * as fsSync from "node:fs";
import * as path from "node:path";

/** True iff `boardDir` is an existing directory containing a `specs/` subdir. */
export function isBoardDir(boardDir: string): boolean {
  try {
    return fsSync.statSync(path.join(boardDir, "specs")).isDirectory();
  } catch {
    return false;
  }
}
