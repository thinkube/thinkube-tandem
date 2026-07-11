/**
 * Project discovery. A **Project** is a bounded
 * multi-repo effort = a *promoted tag with a version-controlled home*:
 * `<product>/projects/<name>/project.yaml` holds its identity/lifecycle/why
 * (`name`, `state`, `tag`, `tep`) — never its membership. Membership is derived
 * elsewhere by resolving the project's `tag` through the tag mesh.
 *
 * Pure `fs` + `yaml` (no vscode) so it's unit-testable vscode-free, mirroring
 * `discoverProducts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";

export interface Project {
  /** The Product (top sidecar dir) this project lives under. */
  product: string;
  /** Project directory name (the project id within its product). */
  id: string;
  /** Display name — `project.yaml` `name`, else the id. */
  name: string;
  /** Lifecycle state — `open` (default) or `done`. */
  state: "open" | "done";
  /** The project-tag: items carrying it are the project's members. Defaults to the id. */
  tag: string;
 /** Optional "why"-TEP reference (e.g. `TEP-3`). */
  tep?: string;
  /** Manifest path relative to the thinking space root. */
  manifestPath: string;
}

const SKIP = new Set([".git", "node_modules"]);

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

/** The thinking space-relative `teps` dir of a thinking space namespace, org-scoped-tree-aware
 *: `<org>/teps` when an `<org>/` child holds a `teps/`, else the
 *  bare `teps`. Mirrors `ThinkubeStore.orgSeg`/`tepsRoot` for the pure (no-store)
 *  Project readers. */
function tepsRootDir(thinkingSpaceDir: string): string {
  try {
    for (const e of fs.readdirSync(thinkingSpaceDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name))
        continue;
      if (fs.existsSync(path.join(thinkingSpaceDir, e.name, "teps")))
        return path.join(thinkingSpaceDir, e.name, "teps");
    }
  } catch {
    /* thinking space dir missing → fall through to the bare-teps default */
  }
  return path.join(thinkingSpaceDir, "teps");
}

/** The umbrella TEP ids under a project's teps tree — the TEPs a
 *  project owns. A project is code-less, so this (plus `project.yaml`) is its
 *  only content. In the org-scoped tree a TEP is the directory `TEP-{id}/`
 *  (holding `tep.md` + its `SP-m` specs), under `<org>/teps` or bare `teps`.
 *  Returns [] when the project / its teps dir is absent. */
export function projectTeps(
  thinkingSpaceRoot: string,
  product: string,
  projectId: string,
): string[] {
  const tepsDir = tepsRootDir(
    path.join(thinkingSpaceRoot, product, "projects", projectId),
  );
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tepsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const mm = /^TEP-([A-Za-z0-9]+)$/.exec(e.name);
    if (mm && mm[1] !== "TEMPLATE") ids.push(mm[1]);
  }
  return ids.sort();
}

function readProject(thinkingSpaceRoot: string, product: string, id: string): Project {
  let m: Record<string, unknown> = {};
  try {
    const parsed = yamlParse(
      fs.readFileSync(
        path.join(thinkingSpaceRoot, product, "projects", id, "project.yaml"),
        "utf8",
      ),
    );
    if (parsed && typeof parsed === "object")
      m = parsed as Record<string, unknown>;
  } catch {
    // missing or malformed manifest → all defaults
  }
  return {
    product,
    id,
    name: str(m.name, id),
    state: m.state === "done" ? "done" : "open",
    tag: str(m.tag, id),
    tep: typeof m.tep === "string" && m.tep.trim() ? m.tep.trim() : undefined,
    manifestPath: `${product}/projects/${id}/project.yaml`,
  };
}

/**
 * Discover Projects under a sidecar thinking space root: every
 * `<product>/projects/<name>/` directory yields a Project (its manifest parsed
 * with graceful defaults). A product with no `projects/` contributes none; a
 * missing/unreadable thinking space root yields `[]`. Sorted by `(product, id)`.
 */
export function discoverProjects(thinkingSpaceRoot: string): Project[] {
  let tops: fs.Dirent[];
  try {
    tops = fs.readdirSync(thinkingSpaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Project[] = [];
  for (const top of tops) {
    if (!top.isDirectory() || top.name.startsWith(".") || SKIP.has(top.name))
      continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(thinkingSpaceRoot, top.name, "projects"), {
        withFileTypes: true,
      });
    } catch {
      continue; // no projects/ under this product
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      out.push(readProject(thinkingSpaceRoot, top.name, e.name));
    }
  }
  return out.sort(
    (a, b) => a.product.localeCompare(b.product) || a.id.localeCompare(b.id),
  );
}
