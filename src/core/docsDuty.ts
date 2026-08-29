/**
 * The one rule that says whether a cut's documentation decision is settled:
 * it lands documentation, it carries a recorded exemption, or it owes
 * documentation and has neither. Every place that needs this verdict —
 * signing, the cut screen, the push to the surface — reads it from here
 * instead of re-deriving it.
 *
 * What counts as documentation is the REPOSITORY's answer, not this file's.
 * A path under `docs/` is not the question: this repository keeps its
 * maintainer notes and its published site under that one directory, so a
 * line added to an internal audit satisfied the duty completely while the
 * pages a person actually reads never moved. The duty was met and the user
 * documentation went stale anyway.
 *
 * So the user documentation is FOUND, the way the door finds how a
 * repository builds: by the marker its own documentation system leaves.
 * A repository that publishes nothing has no marker, and the duty falls
 * back to the plain `docs/` reading — unchanged for a project that never
 * had a site.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Cut, Space } from "./schema";
import { ignoredFor, worthWalking } from "./ignored";

const DOCS_PREFIX = "docs/";

/**
 * Where each documentation system keeps the pages it publishes, relative
 * to the directory holding its config. Knowing that `antora.yml` means
 * "the pages are in modules/ beside me" is the same kind of knowledge as
 * "package.json means npm" — read from the repository, never assumed of it.
 */
const SYSTEMS: { marker: RegExp; pages: string }[] = [
  { marker: /^antora\.ya?ml$/, pages: "modules" },
  { marker: /^mkdocs\.ya?ml$/, pages: "docs" },
  { marker: /^docusaurus\.config\.(js|ts|mjs|cjs)$/, pages: "docs" },
  { marker: /^conf\.py$/, pages: "" },
  { marker: /^_config\.ya?ml$/, pages: "" },
];

/**
 * The directories a repository publishes to its readers, relative to its
 * root and slash-separated. Empty when it publishes nothing.
 */
/**
 * Found once per repository and kept.
 *
 * The walk asks git what the repository ignores and then reads three
 * levels of directories — a third of a second, measured, on this one. It
 * ran on every space opened, and a documentation system is not something
 * a repository grows between two clicks. A new marker appears when a
 * person adds one; reopening the window finds it.
 */
const docsRootsSeen = new Map<string, string[]>();

export function userDocsRoots(repoRoot: string, maxDepth = 3): string[] {
  const remembered = docsRootsSeen.get(repoRoot);
  if (remembered) return remembered;
  const found: string[] = [];
  const skip = ignoredFor(repoRoot);
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile()) {
        const hit = SYSTEMS.find((s) => s.marker.test(e.name));
        if (!hit) continue;
        const root = hit.pages ? path.join(dir, hit.pages) : dir;
        const rel = path.relative(repoRoot, root).split(path.sep).join("/");
        // A marker outside the repository, or one whose pages directory was
        // never created, describes no place a change can land.
        if (rel && !rel.startsWith("..") && fs.existsSync(root)) found.push(rel);
      }
    }
    if (depth >= maxDepth) return;
    for (const e of entries)
      // What the repository itself ignores, never a list of names: a
      // project whose output lands somewhere unusual was walked as if it
      // were source.
      if (e.isDirectory() && worthWalking(e.name, skip) && !e.name.startsWith("."))
        walk(path.join(dir, e.name), depth + 1);
  };
  walk(path.resolve(repoRoot), 0);
  const roots = [...new Set(found)].sort();
  docsRootsSeen.set(repoRoot, roots);
  return roots;
}

/** Found once per host, where the repository root is known. Passing `[]`
 *  restores the plain `docs/` reading (tests pass it to stay hermetic). */
let configured: string[] | undefined;
export function configureDocsRoots(roots: string[] | undefined): void {
  configured = roots;
}

/** The roots in force, for a caller that wants to say where docs belong. */
export function docsRootsInForce(): string[] {
  return configured ?? [];
}

export function docsDuty(
  space: Space,
  cut: Cut,
): { state: "landed" | "exempt" | "missing"; landings: string[]; reason?: string } {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const members = cut.changeIds.map((id) => byId.get(id)).filter((n) => !!n);
  const roots = configured ?? [];
  const isDocumentation = (p: string): boolean =>
    roots.length > 0 ? roots.some((r) => p === r || p.startsWith(`${r}/`)) : p.startsWith(DOCS_PREFIX);
  const landings = [
    ...new Set(
      members.flatMap((n) => (n!.grounding?.touchpoints ?? []).map((t) => t.path)).filter(isDocumentation),
    ),
  ].sort();
  if (landings.length > 0) return { state: "landed", landings };
  if (cut.docsExemption) return { state: "exempt", landings, reason: cut.docsExemption.reason };
  return { state: "missing", landings };
}
