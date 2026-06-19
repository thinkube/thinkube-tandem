/**
 * Pure scope resolution for the Configuration view (SP-tgvhfk_SL-1).
 *
 * The Configuration tree follows the navigator selection: it shows the Claude
 * config for the selected Thinking Space (repo), or a placeholder when nothing
 * is selected. This module holds the vscode-free *decision* — which root scope
 * to render — so it is unit-testable under node:test (no vscode import).
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface SelectedRepo {
  /** Absolute repo root (the code repo, not the sidecar board dir). */
  path: string;
  /** Display name. */
  name: string;
}

export type SelectedScope =
  | { kind: "none" }
  | { kind: "project"; path: string; name: string; hasConfig: boolean };

/**
 * Decide the Configuration view's selection-scoped root entry.
 * `none` → no Thinking Space selected (render a placeholder); `project` → the
 * selected repo, with `hasConfig` true iff it has a `.claude/` dir or a
 * `CLAUDE.md` (so the view can offer setup when absent). `exists` is injectable
 * for testing.
 */
export function resolveSelectedScope(
  selected: SelectedRepo | undefined,
  exists: (p: string) => boolean = fs.existsSync,
): SelectedScope {
  if (!selected) return { kind: "none" };
  const hasConfig =
    exists(path.join(selected.path, ".claude")) ||
    exists(path.join(selected.path, "CLAUDE.md"));
  return {
    kind: "project",
    path: selected.path,
    name: selected.name,
    hasConfig,
  };
}
