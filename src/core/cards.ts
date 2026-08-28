/**
 * Where a project's identity card lives: the store, not the project.
 *
 * The card says "this repository is enabled, and this is its id" — the one
 * link between a working tree and the spaces filed under it. It used to sit
 * in the repository at `.tandem/space.yaml`, on the reasoning that identity
 * should travel with the artifact. It never travelled: the file was
 * untracked, so a clone arrived without it, and committing it would have
 * put a person's own grouping and labels into a product's source.
 *
 * That left one failure with no floor under it. Reinstall the machine: the
 * store comes back from its own remote with every space, every delivery,
 * every record — and every repository is a stranger to it, because the only
 * copy of the mapping was a file on the machine that is gone. Three folders
 * of finished work, and nothing on earth saying which repository each
 * belongs to. Not deleted; unreachable, which is the same thing to a person.
 *
 * So the card is stored beside the work it identifies, keyed by what the
 * repository itself can always say about itself: its remote, and the path
 * of the anchor inside it. A repository with no remote is keyed by where it
 * sits, and re-links itself if it moves.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** One card as the store holds it: the card, plus where it belongs. */
export interface StoredCard {
  id: string;
  label: string;
  product?: string;
  /** The anchor repository's remote — the key when there is one. */
  remote?: string;
  /** The anchor's path inside its git root ("" = the whole repository). */
  prefix?: string;
  /** Where it sat when last seen, for a repository with no remote. */
  at?: string;
  scopes?: { id?: string; remote?: string; prefix?: string; label?: string }[];
}

const CARDS_DIR = "cards";

/**
 * A remote with any credential taken out of it.
 *
 * A repository provisioned against a private forge often carries the
 * credential inline — `https://user:token@host/org/repo.git` — and a card
 * is written to the store, which is a git repository with a remote of its
 * own. Reading the URL verbatim therefore copies a live secret out of the
 * machine. Nothing here needs it: `sameRemote` already ignores credentials
 * when deciding whether two URLs name the same repository.
 */
export function withoutCredentials(url: string): string {
  return url.replace(/^([a-z+]+:\/\/)[^@/]*@/i, "$1");
}

/** The remote a repository names for itself, or "" — never resolved, and
 *  never carrying the credential it may have been cloned with. */
export function remoteOf(gitRoot: string): string {
  try {
    return withoutCredentials(
      execFileSync("git", ["-C", gitRoot, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return "";
  }
}

/** Two remotes are the same repository when they name the same place: the
 *  scheme and the credentials a person happens to use are not identity. */
export function sameRemote(a: string, b: string): boolean {
  const bare = (r: string): string =>
    r
      .trim()
      .replace(/^[a-z+]+:\/\/[^@/]*@/i, "")
      .replace(/^[a-z+]+:\/\//i, "")
      .replace(/^[^@/]*@/, "")
      .replace(/:/g, "/")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  return !!a && !!b && bare(a) === bare(b);
}

/** Every card the store holds. An unreadable one is skipped, never fatal. */
export function allCards(storeRoot: string): StoredCard[] {
  const dir = path.join(storeRoot, CARDS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".yaml"));
  } catch {
    return [];
  }
  const out: StoredCard[] = [];
  for (const n of names) {
    try {
      const raw = parseYaml(fs.readFileSync(path.join(dir, n), "utf8")) as Record<string, unknown>;
      if (typeof raw?.id === "string" && raw.id.trim())
        out.push({
          id: raw.id.trim(),
          label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : raw.id.trim(),
          ...(typeof raw.product === "string" && raw.product.trim() ? { product: raw.product.trim() } : {}),
          ...(typeof raw.remote === "string" && raw.remote.trim() ? { remote: raw.remote.trim() } : {}),
          ...(typeof raw.prefix === "string" ? { prefix: raw.prefix } : {}),
          ...(typeof raw.at === "string" && raw.at.trim() ? { at: raw.at.trim() } : {}),
          ...(Array.isArray(raw.scopes) ? { scopes: raw.scopes as StoredCard["scopes"] } : {}),
        });
    } catch {
      /* an unreadable card is one project not listed, never a broken editor */
    }
  }
  return out;
}

/** Write a card into the store, by its own id. */
export function putCard(storeRoot: string, card: StoredCard): void {
  const dir = path.join(storeRoot, CARDS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  // The last gate before a secret leaves the machine: a remote reaches a
  // card from several callers, and the store has a remote of its own.
  const safe: StoredCard = {
    ...card,
    ...(card.remote ? { remote: withoutCredentials(card.remote) } : {}),
    ...(card.scopes
      ? {
          scopes: card.scopes.map((s) => ({
            ...s,
            ...(s.remote ? { remote: withoutCredentials(s.remote) } : {}),
          })),
        }
      : {}),
  };
  fs.writeFileSync(path.join(dir, `${card.id}.yaml`), stringifyYaml(safe));
}

/**
 * The card for an anchor directory, from the store: matched by the
 * repository's own remote and the anchor's path inside it, or — for a
 * repository that names no remote — by where it sits.
 *
 * The cards and the remote are passed in rather than read here. A walk
 * over a workspace visits hundreds of directories, and reading the store
 * and asking git at each one turns opening a folder into a pause the
 * person can feel.
 */
export function matchCard(
  cards: StoredCard[],
  remote: string,
  prefix: string,
  anchorDir: string,
): StoredCard | undefined {
  if (remote) {
    const hit = cards.find((c) => c.remote && sameRemote(c.remote, remote) && (c.prefix ?? "") === prefix);
    if (hit) return hit;
  }
  return cards.find((c) => !c.remote && c.at && path.resolve(c.at) === path.resolve(anchorDir));
}
