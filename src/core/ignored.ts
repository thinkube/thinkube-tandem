/**
 * What a repository does not author, asked of the repository.
 *
 * Walking a project means skipping the parts it did not write: dependency
 * stores, build output, caches. That was a list of directory names —
 * node_modules, dist, target, .venv — which is a list of the ecosystems
 * somebody thought of. A project whose output lands anywhere else has its
 * generated files walked as if they were source: slow, and occasionally
 * wrong about what the project contains.
 *
 * Every repository already declares the answer, in the one place it is
 * always true: its own ignore rules. Reading them costs one git call per
 * walk and is right in every language, including ones nobody has thought
 * of yet.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * The top-level entries this repository ignores, as names. A directory
 * that is not a git repository ignores nothing — the walk then sees
 * everything, which is what it did before anyone kept a list.
 */
export function ignoredNames(root: string): Set<string> {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain", "--ignored"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(
      out
        .split("\n")
        .filter((l) => l.startsWith("!! "))
        .map((l) => l.slice(3).trim().replace(/\/$/, ""))
        // The IGNORED directory's own name, not the top of its path. Git
      // reports `webview/map/node_modules/`; taking the first segment
      // recorded `webview` — so a directory that merely CONTAINS something
      // ignored became unwalkable, and every walk lost what was under it:
      // the nested part of this very repository, a sub-project's card, a
      // documentation root. The last segment is the thing actually ignored,
      // and skipping it at any depth is what every caller means.
      //
      // The trade-off, stated: a repository that ignores `foo/dist` and
      // keeps a source directory called `dist` elsewhere skips the second
      // too. A name-based walk cannot tell them apart, and losing a source
      // tree wholesale is the worse of the two failures.
      .map((p) => p.split("/").filter(Boolean).pop() ?? "")
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/**
 * Should a walk step into this directory?
 *
 * `.git` is refused whatever the repository says: it is never source, and
 * a repository does not ignore its own git directory.
 */
export function worthWalking(name: string, ignored: ReadonlySet<string>): boolean {
  if (name === ".git") return false;
  return !ignored.has(name);
}

/** The ignored set for a directory, resolved from its enclosing repository
 *  so a subtree walk skips what the whole project skips. */
export function ignoredFor(dir: string, gitRoot?: string): Set<string> {
  return ignoredNames(gitRoot ?? path.resolve(dir));
}
