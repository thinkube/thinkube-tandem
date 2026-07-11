/**
 * spaceRegistry — read space cards (`space.yaml`), list the declared spaces,
 * and verify a resolved working-repository directory (TEP-14).
 *
 * A space's NAME is not here — names are the workspace spelling, resolved by
 * the existing machinery (`repoPathForNamespace` etc.). This module owns:
 *   - `readSpaceCard(dir)` — the card inside one space directory;
 *   - `listDeclaredSpaces(root)` — every space under the thinking-space root
 *     (the list every refusal shows), as root-relative names;
 *   - `assertDeclaredOrgs(card, dir)` — a maintainer subtree on disk that is
 *     not declared refuses loudly;
 *   - `verifyRepoDir(repoPath)` — the resolved directory must exist and be
 *     a git repository (the filesystem copy is the authority).
 *
 * No translation, no fallbacks: a directory without a card is not a space.
 * vscode-free (fs only) — shared by the extension and the MCP subprocess.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SPACE_CARD_FILENAME,
  SpaceCard,
  parseSpaceCard,
} from "./spaceManifest";
import {
  repoPathForNamespace,
  type WorkspaceFolderRef,
} from "./thinkingSpaceNamespace";

/** Dirs never descended into during walks. */
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_DEPTH = 5;

/** Read + validate the card in one space directory; undefined when absent. */
export function readSpaceCard(dir: string): SpaceCard | undefined {
  const cardPath = path.join(dir, SPACE_CARD_FILENAME);
  if (!fs.existsSync(cardPath)) return undefined;
  return parseSpaceCard(fs.readFileSync(cardPath, "utf8"), cardPath);
}

/**
 * Every declared space under the thinking-space root, as root-relative names
 * (which ARE the workspace spellings — the board mirrors the workspace).
 * A directory holding a card is a space; the walk does not descend beneath it.
 */
export function listDeclaredSpaces(thinkingSpaceRoot: string): string[] {
  const out: string[] = [];
  const root = path.resolve(thinkingSpaceRoot);
  const walk = (dir: string, depth: number): void => {
    if (fs.existsSync(path.join(dir, SPACE_CARD_FILENAME))) {
      out.push(path.relative(root, dir).split(path.sep).join("/"));
      return;
    }
    if (depth >= MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out.sort();
}

/**
 * A maintainer subtree (`<dir>/<org>/teps`) that is not declared in the
 * card's `orgs` refuses — membership is declared, never inferred from a
 * stray folder.
 */
export function assertDeclaredOrgs(card: SpaceCard, dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name))
      continue;
    if (!fs.existsSync(path.join(dir, e.name, "teps"))) continue;
    if (!card.orgs.includes(e.name)) {
      throw new Error(
        `${dir}: the maintainer subtree "${e.name}/" holds a teps/ tree but is not ` +
          `declared in space.yaml \`orgs\` [${card.orgs.join(", ")}] — ` +
          `add it (membership is declared, never inferred).`,
      );
    }
  }
}

/**
 * ENFORCEMENT: a space name is valid iff the directory `<root>/<name>` holds
 * a card. One convention, no translation — an invalid name refuses listing
 * the names that exist.
 */
export function assertDeclaredSpace(
  name: string,
  thinkingSpaceRoot: string,
  context: string,
): SpaceCard {
  const dir = path.join(thinkingSpaceRoot, ...name.trim().split("/"));
  const card = readSpaceCard(dir);
  if (card) return card;
  const declared = listDeclaredSpaces(thinkingSpaceRoot);
  throw new Error(
    `${context}: "${name}" is not a declared thinking space (no ${SPACE_CARD_FILENAME} at ${dir}). ` +
      `Declared spaces: ${declared.join(", ") || "(none)"}.`,
  );
}

/**
 * Resolve a space name to its VERIFIED working repository: the name must be
 * a declared space, resolve under a workspace folder, and the directory
 * there must exist and be a git repository (the filesystem copy is the
 * authority). Any miss refuses with the exact reason — never a guess.
 */
export function resolveVerifiedRepo(
  name: string,
  folders: WorkspaceFolderRef[],
  thinkingSpaceRoot: string,
  context: string,
): string {
  assertDeclaredSpace(name, thinkingSpaceRoot, context);
  const repoPath = repoPathForNamespace(name, folders);
  if (!repoPath) {
    throw new Error(
      `${context}: "${name}" does not resolve under any workspace folder ` +
        `(${folders.map((f) => f.name).join(", ") || "no folders configured"}).`,
    );
  }
  verifyRepoDir(repoPath, name);
  return repoPath;
}

/**
 * Verify a resolved working-repository directory: it must exist and be a git
 * repository. The filesystem copy IS the authority — there is nothing else
 * to check it against.
 */
export function verifyRepoDir(repoPath: string, spaceName: string): void {
  if (!fs.existsSync(repoPath)) {
    throw new Error(
      `"${spaceName}" resolves to ${repoPath}, but that directory does not exist.`,
    );
  }
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    throw new Error(
      `"${spaceName}" resolves to ${repoPath}, but that directory is not a git repository.`,
    );
  }
}
