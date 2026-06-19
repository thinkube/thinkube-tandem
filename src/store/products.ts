/**
 * Product discovery (SP-tgvjug / TEP-tgvh8p) — the code-less top node of the
 * hierarchy. A **Product** is a top-level directory in the sidecar board root
 * whose member Thinking Spaces are the board namespaces nested under it,
 * optionally described by a `<product>/product.yaml` (display name + metadata).
 *
 * Pure `fs` + `yaml` (no vscode, no ThinkubeStore) so it is unit-testable
 * vscode-free. The sidecar tree is the source of truth — Products are NOT
 * derived from board ids (a board id's top segment is the on-disk repo dir, not
 * the Product container).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";

export interface Product {
  /** Top-level sidecar directory name — the Product container, e.g. `Platform`. */
  id: string;
  /** Display name: `product.yaml`'s `name`, else the `id`. */
  name: string;
  /** Member board namespaces (`<product>/<rel>`) — the dirs holding a `specs/`. */
  members: string[];
}

/** Members sit 1–3 segments below the Product dir; bound the descent. */
const MAX_DEPTH = 4;
const SKIP = new Set([".git", "node_modules"]);

/** A board-shaped dir holds a `specs/` directory. */
function isBoardShaped(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, "specs")).isDirectory();
  } catch {
    return false;
  }
}

/** Member namespaces under a Product dir (board-shaped dirs are leaves). */
function collectMembers(productDir: string, productId: string): string[] {
  const members: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (isBoardShaped(dir)) {
      members.push(rel ? `${productId}/${rel}` : productId);
      return; // a board is a leaf — never descend into it
    }
    if (depth >= MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      walk(
        path.join(dir, e.name),
        rel ? `${rel}/${e.name}` : e.name,
        depth + 1,
      );
    }
  };
  walk(productDir, "", 0);
  return members.sort();
}

/** `product.yaml` `name`, or `fallback` when absent/malformed (never throws). */
function readProductName(productDir: string, fallback: string): string {
  try {
    const parsed = yamlParse(
      fs.readFileSync(path.join(productDir, "product.yaml"), "utf8"),
    );
    const name = (parsed as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // missing or malformed manifest → fall back to the id
  }
  return fallback;
}

/**
 * Discover Products under a sidecar board root. Each top-level dir with ≥1
 * board-shaped descendant is a Product (its members are those namespaces);
 * a top dir with no board namespace is not a Product. A missing board root (or
 * unreadable dir) yields `[]`.
 */
export function discoverProducts(boardRoot: string): Product[] {
  let tops: fs.Dirent[];
  try {
    tops = fs.readdirSync(boardRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const products: Product[] = [];
  for (const t of tops) {
    if (!t.isDirectory() || t.name.startsWith(".") || SKIP.has(t.name)) continue;
    const dir = path.join(boardRoot, t.name);
    const members = collectMembers(dir, t.name);
    if (members.length === 0) continue; // a Product exists by holding board namespaces
    products.push({ id: t.name, name: readProductName(dir, t.name), members });
  }
  return products.sort((a, b) => a.id.localeCompare(b.id));
}
