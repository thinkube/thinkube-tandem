/**
 * spaceRegistry — read space cards (`space.yaml`), list the declared spaces,
 * and VERIFY that a resolved repository directory really is the repository a
 * card declares (TEP-14).
 *
 * A space's NAME is not here — names are the workspace spelling, resolved by
 * the existing machinery (`repoPathForNamespace` etc.). This module owns:
 *   - `readSpaceCard(dir)` — the card inside one space directory;
 *   - `listDeclaredSpaces(root)` — every space under the thinking-space root
 *     (the list every refusal shows), as root-relative names;
 *   - `assertDeclaredOrgs(card, dir)` — a maintainer subtree on disk that is
 *     not declared refuses loudly;
 *   - `verifyRepoRemote(repoPath, card)` — expected-vs-found remote check
 *     before any tool runs against the repository.
 *
 * No translation, no fallbacks: a directory without a card is not a space.
 * vscode-free (fs + child_process) — shared by the extension and the MCP
 * subprocess.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SPACE_CARD_FILENAME,
  SpaceCard,
  normalizeRemote,
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
 * declared, its card must declare a repository, the workspace must resolve
 * the name to a directory, and that directory's git remote must match the
 * card. Any miss refuses with the exact reason — never a guess.
 */
export async function resolveVerifiedRepo(
  name: string,
  folders: WorkspaceFolderRef[],
  thinkingSpaceRoot: string,
  context: string,
  readRemote?: RemoteReader,
): Promise<string> {
  const card = assertDeclaredSpace(name, thinkingSpaceRoot, context);
  const repoPath = repoPathForNamespace(name, folders);
  if (!repoPath) {
    throw new Error(
      `${context}: "${name}" does not resolve under any workspace folder ` +
        `(${folders.map((f) => f.name).join(", ") || "no folders configured"}).`,
    );
  }
  await verifyRepoRemote(repoPath, card, name, readRemote);
  return repoPath;
}

/** Injectable remote reader (tests); default shells `git remote get-url origin`. */
export type RemoteReader = (repoPath: string) => Promise<string | undefined>;

const defaultRemoteReader: RemoteReader = (repoPath) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoPath, "remote", "get-url", "origin"],
      { timeout: 5000 },
      (err, stdout) => {
        const out = stdout?.trim();
        resolve(err || !out ? undefined : normalizeRemote(out));
      },
    );
  });

/**
 * Verify the resolved repository directory really is the repository the card
 * declares. Cards without `repo:` (project spaces) refuse — there is nothing
 * to run code against. Mismatch/missing remote → error stating expected vs
 * found.
 */
export async function verifyRepoRemote(
  repoPath: string,
  card: SpaceCard,
  spaceName: string,
  readRemote: RemoteReader = defaultRemoteReader,
): Promise<void> {
  if (!card.repo) {
    throw new Error(
      `"${spaceName}" declares no repository (a project space) — it cannot be used as a working repo.`,
    );
  }
  const found = await readRemote(repoPath);
  if (found === card.repo.remote) return;
  throw new Error(
    `"${spaceName}" resolved to ${repoPath}, but that directory is not the declared repository.\n` +
      `  expected remote: ${card.repo.remote}\n` +
      `  found:           ${found ?? "(no origin remote / not a git repository)"}\n` +
      `Fix the checkout or the card's repo.remote.`,
  );
}
