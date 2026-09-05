/**
 * Identity discipline (SPEC §7ter): identity is a minted, immutable id in
 * the project's card, written once at enablement. The card is kept in the
 * STORE, beside the spaces filed under it, and found again from what the
 * repository itself says: its remote, and the anchor's path inside it (see
 * ./cards). A repository with no card in the store is not enabled. Every
 * name — folder basename, product grouping, display title — is a label:
 * set by the human, rendered everywhere, resolved nowhere.
 *
 * A project is a declared set of scopes (§7quater): a scope is
 * (repo identity, optional path prefix). Single-repo project: one scope,
 * no prefix. Monorepo sub-project: the card names the subtree as its
 * prefix. Multirepo: the anchor card lists the other scopes.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { StoredCard, allCards, matchCard, putCard, remoteOf } from "./cards";
import { ignoredFor, worthWalking } from "./ignored";

/** One member scope of a project (beyond the anchor). */
export interface ProjectScope {
  /** The member repo's own minted id (from its card), when known. */
  id?: string;
  /** Remote URL hint — a label for humans and pickers, never resolved. */
  remote?: string;
  /** Path prefix inside the member repo ("" = whole repo). */
  prefix?: string;
  label?: string;
}

/** The project card, as the rest of the extension reads it. */
export interface SpaceCard {
  /** Minted at enablement, immutable, mechanical. Never a spelling. */
  id: string;
  /** Human label — rendered everywhere, resolved nowhere. */
  label: string;
  /** Product grouping label (e.g. "KubeXlat", "Platform"). */
  product?: string;
  /** Remote URL hint of the anchor repo. */
  remote?: string;
  /** Member scopes beyond the anchor (multirepo projects). */
  scopes?: ProjectScope[];
}

const CARD_RELPATH = path.join(".tandem", "space.yaml");

/** Minted ids stay human-tolerable (label root + short suffix) because the
 *  store keys directories by them — but the LABEL half is frozen at mint:
 *  renaming the label later never changes the id. */
export function mintId(label: string, rand: () => string = () => randomBytes(3).toString("hex")): string {
  const root =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "space";
  return `${root}-${rand()}`;
}

/**
 * Read the card for an anchor directory. The STORE is the record; a
 * `.tandem/space.yaml` left by an older install is imported into it once
 * and then never needed again — a machine that is reinstalled restores its
 * store and every clone re-links itself, which a file in the working tree
 * could never do.
 */
export function readCard(dir: string, storeRoot: string, seen?: Lookup): SpaceCard | undefined {
  const gitRoot = findGitRoot(dir) ?? dir;
  if (linkedWorktree(gitRoot)) return undefined;
  const prefix = path.relative(gitRoot, dir).split(path.sep).join("/");
  const cards = seen ? seen.cards : allCards(storeRoot);
  const remote = seen ? seen.remote(gitRoot) : remoteOf(gitRoot);
  const stored = matchCard(cards, remote, prefix, dir);
  if (stored) {
    // A clone whose card reached the store from ANOTHER checkout still
    // carries its own working-tree copy: never read, never removed, and
    // untracked in every `git status` the person runs. The store answers,
    // so the file has no reader left.
    if (readLegacyCard(dir)?.id === stored.id) retireLegacyCard(dir);
    return {
      id: stored.id,
      label: stored.label,
      ...(stored.product ? { product: stored.product } : {}),
      ...(stored.remote ? { remote: stored.remote } : {}),
      ...(stored.scopes ? { scopes: stored.scopes } : {}),
    };
  }
  const legacy = readLegacyCard(dir);
  if (!legacy) return undefined;
  const known = remote || legacy.remote || "";
  const imported = {
    id: legacy.id,
    label: legacy.label,
    ...(legacy.product ? { product: legacy.product } : {}),
    ...(known ? { remote: known } : { at: path.resolve(dir) }),
    prefix,
    ...(legacy.scopes ? { scopes: legacy.scopes } : {}),
  };
  putCard(storeRoot, imported);
  seen?.cards.push(imported);
  retireLegacyCard(dir);
  return legacy;
}

/** The store and the remotes read once, for a walk that visits many
 *  directories under one repository. */
interface Lookup {
  cards: StoredCard[];
  remote: (gitRoot: string) => string;
}

/** Drop the working-tree card once the store holds it. `.tandem` itself
 *  stays: it also carries proved facts, conventions and prompts, which are
 *  the repository's own and not a person's grouping. */
function retireLegacyCard(dir: string): void {
  try {
    fs.rmSync(path.join(dir, CARD_RELPATH));
  } catch {
    /* a card that cannot be removed is simply read again and re-imported */
  }
}

/** A card an older install left in the working tree. Read once, to import. */
function readLegacyCard(dir: string): SpaceCard | undefined {
  try {
    const raw = parseYaml(fs.readFileSync(path.join(dir, CARD_RELPATH), "utf8")) as Record<string, unknown>;
    if (typeof raw?.id !== "string" || !raw.id.trim()) return undefined;
    return {
      id: raw.id.trim(),
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : path.basename(dir),
      ...(typeof raw.product === "string" && raw.product.trim() ? { product: raw.product.trim() } : {}),
      ...(typeof raw.remote === "string" && raw.remote.trim() ? { remote: raw.remote.trim() } : {}),
      ...(Array.isArray(raw.scopes)
        ? {
            scopes: (raw.scopes as Record<string, unknown>[])
              .filter((s) => s && typeof s === "object")
              .map((s) => ({
                ...(typeof s.id === "string" ? { id: s.id } : {}),
                ...(typeof s.remote === "string" ? { remote: s.remote } : {}),
                ...(typeof s.prefix === "string" ? { prefix: s.prefix } : {}),
                ...(typeof s.label === "string" ? { label: s.label } : {}),
              })),
          }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/** Mint a card ONCE. An existing card refuses — identity is immutable. */
export function mintCard(
  dir: string,
  init: { label: string; product?: string; remote?: string },
  storeRoot: string,
  rand?: () => string,
): { ok: true; card: SpaceCard } | { ok: false; reason: string } {
  if (readCard(dir, storeRoot))
    return { ok: false, reason: "already enabled — a card exists and identity is immutable" };
  if (linkedWorktree(findGitRoot(dir) ?? dir))
    return {
      ok: false,
      reason: "this is a git worktree — enable the repository it belongs to instead",
    };
  const card: SpaceCard = {
    id: mintId(init.label, rand),
    label: init.label,
    ...(init.product ? { product: init.product } : {}),
    ...(init.remote ? { remote: init.remote } : {}),
  };
  const gitRoot = findGitRoot(dir) ?? dir;
  const prefix = path.relative(gitRoot, dir).split(path.sep).join("/");
  const remote = init.remote || remoteOf(gitRoot);
  putCard(storeRoot, {
    id: card.id,
    label: card.label,
    ...(card.product ? { product: card.product } : {}),
    ...(remote ? { remote } : { at: path.resolve(dir) }),
    prefix,
  });
  return { ok: true, card };
}

export interface EnabledProject {
  card: SpaceCard;
  /** The anchor scope directory (where the card sits). */
  anchorDir: string;
  /** The enclosing git repository root. */
  gitRoot: string;
  /** Path prefix of the anchor inside the git root ("" = whole repo). */
  prefix: string;
}

/**
 * A linked git worktree: a second checkout of a repository already
 * identified elsewhere. Its `.git` is a FILE pointing back at the real
 * repository, where the main checkout has a directory.
 *
 * It answers with the same remote and the same prefix as its repository,
 * so a card matched on those alone would claim every worktree a run has
 * open — one project drawn as twenty. A worktree carries no identity of
 * its own: the repository it belongs to already has one.
 */
function linkedWorktree(gitRoot: string): boolean {
  try {
    return fs.statSync(path.join(gitRoot, ".git")).isFile();
  } catch {
    return false;
  }
}

/** Walk upward from `dir` to the enclosing git root ('.git' entry). */
function findGitRoot(dir: string): string | undefined {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return undefined;
    cur = up;
  }
}

/**
 * Discover the enabled projects under a workspace folder: the folder's own
 * card plus any subtree cards (monorepo sub-projects), each with its
 * mechanical prefix. Pure filesystem walk, bounded by depth.
 */
export function discoverProjects(folder: string, storeRoot: string, maxDepth = 4): EnabledProject[] {
  const out: EnabledProject[] = [];
  const remotes = new Map<string, string>();
  const seen: Lookup = {
    cards: allCards(storeRoot),
    remote: (gitRoot) => {
      const hit = remotes.get(gitRoot);
      if (hit !== undefined) return hit;
      const r = remoteOf(gitRoot);
      remotes.set(gitRoot, r);
      return r;
    },
  };
  const skip = ignoredFor(folder);
  const walk = (dir: string, depth: number): void => {
    const card = readCard(dir, storeRoot, seen);
    if (card) {
      const gitRoot = findGitRoot(dir) ?? dir;
      out.push({
        card,
        anchorDir: dir,
        gitRoot,
        prefix: path.relative(gitRoot, dir).split(path.sep).join("/"),
      });
    }
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // What this project does not author, asked of the project. A list of
      // names would be a list of the ecosystems somebody thought of.
      if (!worthWalking(e.name, skip)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.resolve(folder), 0);
  return out;
}

/**
 * Map a project's scopes onto currently open workspace folders BY IDENTITY:
 * a scope is "open" when some open project card carries its id. Returns the
 * scopes that are NOT open, so the picker can say so (§7quater).
 */
export function scopesNotOpen(
  project: EnabledProject,
  open: EnabledProject[],
): ProjectScope[] {
  const openIds = new Set(open.map((p) => p.card.id));
  return (project.card.scopes ?? []).filter((s) => !s.id || !openIds.has(s.id));
}

/** Products are labels; one lives as a tiny file so an EMPTY product (just
 *  created, no projects yet) still exists. The list is the union of these
 *  files and every enabled project's product label. */
export function listProducts(storeRoot: string, projects: EnabledProject[]): string[] {
  const names = new Set(projects.map((p) => p.card.product).filter((x): x is string => !!x));
  try {
    for (const f of fs.readdirSync(path.join(storeRoot, "products")))
      if (f.endsWith(".yaml")) {
        try {
          const raw = parseYaml(
            fs.readFileSync(path.join(storeRoot, "products", f), "utf8"),
          ) as { name?: string };
          if (raw?.name) names.add(raw.name);
        } catch {
          /* an unreadable product file is skipped */
        }
      }
  } catch {
    /* no products dir yet */
  }
  return [...names].sort();
}

/** Create a product — one immutable file, refused if the name exists. */
export function createProduct(
  storeRoot: string,
  name: string,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: "a product needs a name" };
  const dir = path.join(storeRoot, "products");
  const file = path.join(dir, `${mintId(trimmed, () => "").replace(/-$/, "")}.yaml`);
  if (fs.existsSync(file)) return { ok: false, reason: `product "${trimmed}" already exists` };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, stringifyYaml({ name: trimmed }));
  return { ok: true };
}

/** Set or change a card's PRODUCT — a label edit; the minted id is never
 *  touched. Refused when the directory is not enabled. */
export function setCardProduct(
  dir: string,
  product: string,
  storeRoot: string,
): { ok: true } | { ok: false; reason: string } {
  const card = readCard(dir, storeRoot);
  if (!card) return { ok: false, reason: "not an enabled project (no card)" };
  const gitRoot = findGitRoot(dir) ?? dir;
  const prefix = path.relative(gitRoot, dir).split(path.sep).join("/");
  const remote = card.remote || remoteOf(gitRoot);
  putCard(storeRoot, {
    id: card.id,
    label: card.label,
    product: product.trim(),
    ...(remote ? { remote } : { at: path.resolve(dir) }),
    prefix,
    ...(card.scopes ? { scopes: card.scopes } : {}),
  });
  return { ok: true };
}
