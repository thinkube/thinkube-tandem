/**
 * Resolve a Spec's WORKING repository — the repo the orchestrator branches a
 * worktree in and where its accept/reject git ops run. Shared by `orchestrate`
 * (dispatch/attend/reject) and `thinkingSpaces` (panel accept).
 */
import * as vscode from "vscode";

import { ThinkubeStore } from "./ThinkubeStore";
import { resolveVerifiedRepo } from "./spaceRegistry";

/**
 * The WORKING repository for a Spec — the repo the orchestrator branches a
 * worktree in. For a normal Spec that is the thinking space's own repo (`fallback`); for
 * a **project member** Spec (which lives nested under a cross-repo project
 * umbrella, not in any code repo's thinking space) the working repo is named by the
 * spec's `repo:` frontmatter (a thinking space namespace), resolved to a path the same
 * way `SpecsProvider.crossThinkingSpaceSpecs` does. So the spec's *location* never
 * decides the worktree — its `repo:` does (TEP-5 / the project-layer cutover).
 */
export async function workingRepoPath(
  store: ThinkubeStore,
  spec: string,
  fallback: string,
): Promise<string> {
  const repoNs = await specRepoNamespace(store, spec);
  // A normal Spec has no `repo:` — its working repo IS the thinking space's own repo.
  if (!repoNs) return fallback;
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  const root = vscode.workspace
    .getConfiguration("thinkube.thinkingSpace")
    .get<string>("root")
    ?.trim();
  if (!root) {
    throw new Error(
      `Spec ${spec} names repo: "${repoNs}" but no thinking-space root is configured ` +
        `(set \`thinkube.thinkingSpace.root\`).`,
    );
  }
  // ENFORCEMENT (TEP-14): the name must be a declared space, resolve under a
  // workspace folder, and the directory's git remote must match the card —
  // verified before ANY git operation runs there. Refusals state the reason.
  return resolveVerifiedRepo(repoNs, folders, root, `Spec ${spec} \`repo:\``);
}

/** The thinking space-namespace a Spec names as its working repo via `repo:`, or
 *  undefined for a normal same-repo Spec. Lets a caller tell a project member
 *  (cross-repo) from a same-repo Spec without re-reading the doc. */
export async function specRepoNamespace(
  store: ThinkubeStore,
  spec: string,
): Promise<string | undefined> {
  const fm = (await store.getFile(store.pathForSpecDoc(spec)))?.frontmatter;
  const repoNs = typeof fm?.repo === "string" ? fm.repo.trim() : "";
  return repoNs || undefined;
}
