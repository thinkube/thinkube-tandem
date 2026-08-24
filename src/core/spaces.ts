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

function slugifySpaceName(name: string): string {
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
export function spacesHome(storeRoot: string, ownerId: string, kind: SpaceOwnerKind): string {
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

/** The single key a session, its tab and its pushes share — the same
 *  string joins any owner (a repository id or a "wp:"-prefixed project
 *  id, kept intact) to a slug. */
export function spaceKey(ownerKey: string, slug: string): string {
  return `${ownerKey}/${slug}`;
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

/** What deleting a thinking space would destroy, and what it would not. */
export interface DeletionCost {
  exists: boolean;
  /** Sentences the human wrote, which only exist here. */
  asks: number;
  /** TEP numbers minted here. Minted is not merged. */
  teps: string[];
  /** Branches this space pushed. Deleting the space leaves them standing. */
  branches: string[];
  /** Deliveries the human accepted — merged into the project. These are
   *  the only thing that cannot be taken back, so they are the only thing
   *  that refuses a deletion. */
  merged: string[];
}

/**
 * What it would cost to delete this space, so the question can be asked
 * before the act rather than answered by a refusal after it.
 */
export function deletionCost(
  storeRoot: string,
  ownerId: string,
  slug: string,
  now: () => string,
  kind: SpaceOwnerKind = "repository",
): DeletionCost {
  const dir = path.join(spacesHome(storeRoot, ownerId, kind), slug);
  if (!fs.existsSync(dir))
    return { exists: false, asks: 0, teps: [], branches: [], merged: [] };
  const { space } = loadFolded(dir, path.join(dir, "_probe"), "_probe", now);
  const signed = space.cuts.filter((c) => c.signature);
  return {
    exists: true,
    asks: space.asks.length,
    teps: signed.map((c) => c.tepId).filter((t): t is string => !!t),
    branches: [...new Set(space.deliveries.map((d) => d.branch))],
    merged: space.deliveries
      .filter((d) => d.acceptedAt)
      .map((d) => space.cuts.find((c) => c.id === d.cutId)?.tepId ?? d.branch),
  };
}

/**
 * Delete a thinking space — refused only once work from it was ACCEPTED,
 * which merged it into the project. Until then nothing here is a record
 * of anything the world has seen: a signature mints a number and pushes a
 * branch, both of which outlive the space and neither of which the space
 * is needed to explain. Refusing on the signature alone made every space
 * that was ever built in permanent, which is a punishment for using the
 * machine rather than a rule protecting anything.
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
  const cost = deletionCost(storeRoot, ownerId, slug, now, kind);
  if (cost.merged.length)
    return {
      ok: false,
      reason: `${cost.merged.join(", ")} was accepted and merged into the project — a space that delivered something is the record of how it was decided, and cannot be erased`,
    };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

/**
 * TEP numbers are unique PER OWNER (repository or project) across all of
 * its thinking spaces — Amendment §2's "branches never collide". A
 * durable counter file at the owner level is the source; single writer
 * per author (the same structural discipline as author-scoped ids).
 */
export function nextTepNumber(
  storeRoot: string,
  ownerId: string,
  author: string,
  kind: SpaceOwnerKind = "repository",
): number {
  const home = spacesHome(storeRoot, ownerId, kind);
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, `tep-counter-${author}.txt`);
  let n = 0;
  try {
    n = parseInt(fs.readFileSync(file, "utf8").trim(), 10) || 0;
  } catch {
    /* first TEP for this author under this owner */
  }
  const next = n + 1;
  fs.writeFileSync(file, `${next}\n`);
  return next;
}
