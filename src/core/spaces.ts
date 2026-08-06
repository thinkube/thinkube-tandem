/**
 * The thinking-space level (SPEC Amendment 1): a repository or project
 * holds MANY named thinking spaces, each an independent stream of
 * thinking. On disk a space is one directory level —
 * `spaces/<repository-id>/<space-name>/<user>/…` — with the same
 * append-only records beneath it as before. Names are human-chosen;
 * the directory name is the slug; creation refuses duplicates; deletion
 * refuses once anything was signed inside (a frozen scope is not
 * erasable).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { loadFolded } from "./records";

export function slugifySpaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The directory holding one owner's spaces. A repository's spaces live
 *  under spaces/<id>/; a work-project's live in its own projects/<id>/ dir
 *  (Amendment 1 layout). */
export type SpaceOwnerKind = "repository" | "project";
function spacesHome(storeRoot: string, ownerId: string, kind: SpaceOwnerKind): string {
  return path.join(storeRoot, kind === "project" ? "projects" : "spaces", ownerId);
}

export interface SpaceRef {
  /** Directory name — the stable slug. */
  slug: string;
  /** The human-chosen display name (name.txt beside the records; slug fallback). */
  label: string;
}

/** Every thinking space under an owner, oldest directory first. */
export function listThinkingSpaces(storeRoot: string, ownerId: string, kind: SpaceOwnerKind = "repository"): SpaceRef[] {
  const home = spacesHome(storeRoot, ownerId, kind);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => {
      let label = e.name;
      try {
        const t = fs.readFileSync(path.join(home, e.name, "name.txt"), "utf8").trim();
        if (t) label = t;
      } catch {
        /* slug is the label */
      }
      return { slug: e.name, label };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function createThinkingSpace(
  storeRoot: string,
  ownerId: string,
  name: string,
  kind: SpaceOwnerKind = "repository",
): { ok: true; slug: string } | { ok: false; reason: string } {
  const slug = slugifySpaceName(name);
  if (!slug) return { ok: false, reason: "a thinking space needs a name" };
  const dir = path.join(spacesHome(storeRoot, ownerId, kind), slug);
  if (fs.existsSync(dir))
    return { ok: false, reason: `a thinking space named "${slug}" already exists here` };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name.txt"), name.trim() + "\n");
  return { ok: true, slug };
}

/** Where a session reads and writes for one (owner, space, user). */
export function thinkingSpaceDirs(
  storeRoot: string,
  ownerId: string,
  slug: string,
  author: string,
  kind: SpaceOwnerKind = "repository",
): { storeDir: string; foldDir: string } {
  const foldDir = path.join(spacesHome(storeRoot, ownerId, kind), slug);
  return { storeDir: path.join(foldDir, author), foldDir };
}

/**
 * Delete a thinking space — refused once any signed cut exists in the fold
 * (any user): what was signed is a record, not something erasable.
 */
export function deleteThinkingSpace(
  storeRoot: string,
  ownerId: string,
  slug: string,
  now: () => string,
  kind: SpaceOwnerKind = "repository",
): { ok: boolean; reason?: string } {
  const dir = path.join(spacesHome(storeRoot, ownerId, kind), slug);
  if (!fs.existsSync(dir)) return { ok: false, reason: "no such thinking space" };
  const { space } = loadFolded(dir, path.join(dir, "_probe"), "_probe", now);
  if (space.cuts.some((c) => c.signature))
    return {
      ok: false,
      reason: "something was already signed in this thinking space — it is a record now, not erasable",
    };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}
