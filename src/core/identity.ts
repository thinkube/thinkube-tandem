/**
 * Identity discipline (SPEC §7ter): identity is a minted, immutable id
 * stored in the project's own card — `.tandem/space.yaml`, written once at
 * enablement. It travels with the repo through renames and clones, it is
 * read mechanically from the artifact, and the remote URL is recorded
 * beside it as a hint, never resolved. A directory without a card is not
 * enabled. Every name — folder basename, product grouping, display title —
 * is a label: set by the human, rendered everywhere, resolved nowhere.
 *
 * A project is a declared set of scopes (§7quater): a scope is
 * (repo identity, optional path prefix). Single-repo project: one scope,
 * no prefix. Monorepo sub-project: the card lives in the subtree and the
 * prefix is derived mechanically from where the card sits relative to the
 * enclosing git root. Multirepo: the anchor card lists the other scopes.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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

/** The project card — `.tandem/space.yaml` at the anchor scope. */
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

export const CARD_RELPATH = path.join(".tandem", "space.yaml");

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

/** Read a card at `dir` (the anchor scope directory). Absent → not enabled. */
export function readCard(dir: string): SpaceCard | undefined {
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
  rand?: () => string,
): { ok: true; card: SpaceCard } | { ok: false; reason: string } {
  if (readCard(dir))
    return { ok: false, reason: "already enabled — a card exists and identity is immutable" };
  const card: SpaceCard = {
    id: mintId(init.label, rand),
    label: init.label,
    ...(init.product ? { product: init.product } : {}),
    ...(init.remote ? { remote: init.remote } : {}),
  };
  fs.mkdirSync(path.join(dir, path.dirname(CARD_RELPATH)), { recursive: true });
  fs.writeFileSync(path.join(dir, CARD_RELPATH), stringifyYaml(card));
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
export function discoverProjects(folder: string, maxDepth = 4): EnabledProject[] {
  const out: EnabledProject[] = [];
  const walk = (dir: string, depth: number): void => {
    const card = readCard(dir);
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
      if (["node_modules", ".git", "out", "out-test", "build", "dist"].includes(e.name)) continue;
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
): { ok: true } | { ok: false; reason: string } {
  const card = readCard(dir);
  if (!card) return { ok: false, reason: "not an enabled project (no card)" };
  fs.writeFileSync(
    path.join(dir, CARD_RELPATH),
    stringifyYaml({ ...card, product: product.trim() }),
  );
  return { ok: true };
}
