/**
 * Product-scoped context sources (2026-07-18).
 *
 * Field defect: contextualize read `workspaceFolders[0]` — the emptiest
 * folder of a 4-root workspace — and was structurally blind to the code the
 * space is about. The correction is the methodology's own tier structure
 * (user doctrine): specs bind to a SINGLE repository (worktree isolation),
 * and a thinking space's context boundary is the PRODUCT — its context is
 * the repositories under that product, nothing wider.
 *
 * The mapping is fully structural, never user-typed:
 *  - product      = first segment of the space's namespace ("Platform/…")
 *  - repositories = every sidecar card `<store>/<product>/**\/space.yaml`,
 *                   EXCLUDING `<product>/projects/**` (projects are
 *                   code-less by doctrine), mapped back to its repo path via
 *                   the workspace spelling (repoPathForNamespace).
 *  - plus the space's own sidecar dir (methodology memory: prior TEPs,
 *                   retros, defect lessons — never treated as code).
 *
 * Pure w.r.t. vscode; fs access is injected-testable via existsSync-shaped
 * checks on real temp trees in tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  repoPathForNamespace,
  type WorkspaceFolderRef,
} from "../store/thinkingSpaceNamespace";

const SPACE_CARD = "space.yaml";
const MAX_DEPTH = 5;

/** First namespace segment — the product tier. */
export function productOf(namespace: string): string {
  return namespace.split("/").filter(Boolean)[0] ?? "";
}

/**
 * The repositories under a product: sidecar cards under
 * `<store>/<product>` (skipping `projects/` — code-less), mapped to repo
 * paths that exist on disk.
 */
export function productRepoSources(
  sidecarRoot: string,
  product: string,
  folders: readonly WorkspaceFolderRef[],
): string[] {
  if (!product) return [];
  const productDir = path.join(sidecarRoot, product);
  const namespaces: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (rel && entries.some((e) => e.isFile() && e.name === SPACE_CARD)) {
      namespaces.push(`${product}/${rel}`);
      return; // cards do not nest
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      // Projects are CODE-LESS thinking spaces (their specs carry `repo:`) —
      // they contribute methodology memory, never code context.
      if (!rel && e.name === "projects") continue;
      walk(
        path.join(dir, e.name),
        rel ? `${rel}/${e.name}` : e.name,
        depth + 1,
      );
    }
  };
  walk(productDir, "", 0);

  const sources: string[] = [];
  for (const ns of namespaces.sort()) {
    const repo = repoPathForNamespace(ns, [...folders]);
    if (repo && fs.existsSync(repo) && !sources.includes(repo)) {
      sources.push(repo);
    }
  }
  return sources;
}

/**
 * Full declared context for a space: the product's repositories plus the
 * space's own sidecar dir (methodology memory).
 */
export function contextSourcesForSpace(
  sidecarRoot: string | undefined,
  namespace: string,
  folders: readonly WorkspaceFolderRef[],
  scope?: readonly string[],
): string[] {
  if (!sidecarRoot) return [];
  const candidates = productRepoSources(
    sidecarRoot,
    productOf(namespace),
    folders,
  );
  const repos =
    scope && scope.length > 0
      ? candidates.filter((c) => scope.includes(c))
      : candidates;
  const sources = [...repos];
  const own = path.join(sidecarRoot, ...namespace.split("/"));
  if (fs.existsSync(own) && !sources.includes(own)) sources.push(own);
  return sources;
}

/** The candidate repositories under the product — what the human selects FROM. */
export function candidateRepoSources(
  sidecarRoot: string | undefined,
  namespace: string,
  folders: readonly WorkspaceFolderRef[],
): string[] {
  if (!sidecarRoot) return [];
  return productRepoSources(sidecarRoot, productOf(namespace), folders);
}
