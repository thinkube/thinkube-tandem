/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The module: the unit the record is kept for.
 *
 * A module is a folder that is built, deployed and answers on its own. It
 * says so with a `thinkube.yaml` of its own. One repository can hold several
 * (Thinkube Control and each of its extensions), and one product can spread
 * over several repositories. A repository that declares nothing is one
 * module: its root.
 *
 * A file belongs to the deepest module that contains it, so the root module
 * of a repository does not own what a module inside it owns.
 *
 * A module's identity is its card in the store, found again from what the
 * repository says about itself: its remote, and the module's path inside it.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { mintCard, readCard } from "../core/identity";

const DECLARATION = "thinkube.yaml";

/** Where a module sits on this machine. */
interface Place {
  /** The module's folder, absolute. */
  dir: string;
  /** The root of the repository that holds it, absolute. */
  gitRoot: string;
  /** The module's path inside the repository, "/"-separated; "" is the root. */
  prefix: string;
  /** Whether the folder has a `thinkube.yaml` of its own. */
  declared: boolean;
}

/** A place with its identity in the store. */
interface Module extends Place {
  id: string;
  label: string;
  product?: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The repository root that holds `dir`, or undefined outside a repository.
 *  A linked worktree is its own root: its `.git` is a file. */
function gitRootOf(dir: string): string | undefined {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return undefined;
    cur = up;
  }
}

function placeIn(gitRoot: string, dir: string): Place {
  return {
    dir,
    gitRoot,
    prefix: path.relative(gitRoot, dir).split(path.sep).join("/"),
    declared: fs.existsSync(path.join(dir, DECLARATION)),
  };
}

/** The place of a folder already known to be a module's; undefined when the
 *  folder is gone or no longer inside a repository. */
export function placeAt(dir: string): Place | undefined {
  const gitRoot = fs.existsSync(dir) ? gitRootOf(dir) : undefined;
  return gitRoot ? placeIn(gitRoot, path.resolve(dir)) : undefined;
}

/**
 * The module a folder belongs to: the nearest folder at or above it with a
 * `thinkube.yaml`, else the root of its repository. Undefined outside a
 * repository: there is nothing to build or deploy there.
 */
export function placeOf(dir: string): Place | undefined {
  const gitRoot = gitRootOf(dir);
  if (!gitRoot) return undefined;
  let cur = path.resolve(dir);
  while (cur !== gitRoot) {
    if (fs.existsSync(path.join(cur, DECLARATION))) return placeIn(gitRoot, cur);
    cur = path.dirname(cur);
  }
  return placeIn(gitRoot, gitRoot);
}

/**
 * The paths inside a repository that declare a module, as git tracks them.
 * The root is not in the list: it is a module whether it declares or not.
 */
export function declaredPrefixes(gitRoot: string): string[] {
  return git(gitRoot, ["ls-files", "-z", "--", `:(glob)**/${DECLARATION}`])
    .split("\0")
    .filter(Boolean)
    .map((f) => path.posix.dirname(f))
    .filter((p) => p !== ".")
    .sort();
}

/** The prefix of the module that owns a file: the deepest that contains it. */
export function owningPrefix(file: string, prefixes: readonly string[]): string {
  let best = "";
  for (const p of prefixes)
    if (p.length > best.length && (file === p || file.startsWith(`${p}/`))) best = p;
  return best;
}

/** Every module of one repository: its root, and each folder that declares. */
function placesIn(gitRoot: string): Place[] {
  return [
    placeIn(gitRoot, gitRoot),
    ...declaredPrefixes(gitRoot).map((p) => placeIn(gitRoot, path.join(gitRoot, ...p.split("/")))),
  ];
}

/**
 * The modules a session standing in `dir` can reach: those of the repository
 * that holds it, or, outside a repository, those of the repositories under
 * it. The walk stops at each repository it finds and asks git for the rest.
 */
export function placesFrom(dir: string, maxDepth = 3): Place[] {
  const inside = gitRootOf(dir);
  if (inside) return placesIn(inside);
  const out: Place[] = [];
  const walk = (cur: string, depth: number): void => {
    if (fs.existsSync(path.join(cur, ".git"))) {
      out.push(...placesIn(cur));
      return;
    }
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name)))
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        walk(path.join(cur, e.name), depth + 1);
  };
  walk(path.resolve(dir), 0);
  return out;
}

/** The module at a place, when the store has a card for it. */
export function moduleAt(place: Place, storeRoot: string): Module | undefined {
  const card = readCard(place.dir, storeRoot);
  if (!card) return undefined;
  return {
    ...place,
    id: card.id,
    label: card.label,
    ...(card.product ? { product: card.product } : {}),
  };
}

/** The module at a place, with a card minted for it when it has none. */
export function enableModule(
  place: Place,
  storeRoot: string,
): { ok: true; module: Module } | { ok: false; reason: string } {
  const known = moduleAt(place, storeRoot);
  if (known) return { ok: true, module: known };
  const minted = mintCard(place.dir, { label: path.basename(place.dir) }, storeRoot);
  if (!minted.ok) return minted;
  return { ok: true, module: { ...place, id: minted.card.id, label: minted.card.label } };
}
