/**
 * What a thinking space's runs left on the machine and the forge.
 *
 * A space that was never merged is not a record of anything the world has
 * seen — but its runs wrote outside the space's own directory: worktrees
 * and tester snapshots beside the repository, oracle stores and runner
 * trees, the lock file that guards the repository, local `tandem/…`
 * branches and their pushed copies on the forge. Deleting the space
 * removed only the store directory, so everything else outlived the
 * thinking that created it — including locks that then refused the next
 * run in the space's name.
 *
 * Best-effort throughout: cleanup never blocks a deletion, and whatever
 * could not be removed is returned as a note rather than swallowed.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defaultExec } from "./oracle";
import type { Exec } from "./oracle";

export interface ResidueSweep {
  /** What was removed, for the surface to say. */
  removed: string[];
  /** What could not be, and why — spoken, never silent. */
  notes: string[];
}

/** Worktree directory names are `<runName with / as __>`; a TEP's trees
 *  may carry a project prefix, so a bare TEP id matches by suffix too. */
const belongsTo = (entry: string, teps: string[], wtNames: string[]): boolean => {
  const base = entry.endsWith("-tester") ? entry.slice(0, -"-tester".length) : entry;
  return (
    wtNames.includes(base) ||
    teps.some((t) => base === t || base.endsWith(`__${t}`))
  );
};

export async function sweepSpaceResidue(args: {
  repoRoot: string;
  /** TEP ids the space minted (runs that crashed left no delivery). */
  teps: string[];
  /** Branches its deliveries pushed (`tandem/<runName>`). */
  branches: string[];
  exec?: Exec;
  log?: (line: string) => void;
}): Promise<ResidueSweep> {
  const exec = args.exec ?? defaultExec;
  const removed: string[] = [];
  const notes: string[] = [];
  if (!args.teps.length && !args.branches.length) return { removed, notes };
  const wtRoot = path.join(
    path.dirname(args.repoRoot),
    `${path.basename(args.repoRoot)}-worktrees`,
  );
  const wtNames = args.branches.map((b) =>
    b.replace(/^tandem\//, "").replace(/\//g, "__"),
  );

  // The trees: everything under the worktree root this space's runs named.
  let entries: string[] = [];
  try {
    entries = await fs.readdir(wtRoot);
  } catch {
    return { removed, notes };
  }
  const mine = entries.filter(
    (e) => !["locks", "oracle-store", "oracle-runners"].includes(e) && belongsTo(e, args.teps, wtNames),
  );
  for (const e of mine) {
    const abs = path.join(wtRoot, e);
    await exec("git", ["-C", args.repoRoot, "worktree", "remove", "--force", abs], args.repoRoot);
    await fs.rm(abs, { recursive: true, force: true }).catch(() => {});
    removed.push(`worktree ${e}`);
  }
  if (mine.length)
    await exec("git", ["-C", args.repoRoot, "worktree", "prune"], args.repoRoot);

  // The bookkeeping beside the trees: oracle stores, runner trees, locks.
  for (const sub of ["oracle-store", "oracle-runners", "locks"]) {
    const dir = path.join(wtRoot, sub);
    let inner: string[] = [];
    try {
      inner = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const e of inner) {
      const name = e.endsWith(".json") ? e.slice(0, -".json".length) : e;
      // Runner trees are named `<wtName>-SL-…` — strip the slice tail.
      const stem = name.replace(/-SL-\d+.*$/, "");
      if (!belongsTo(name, args.teps, wtNames) && !belongsTo(stem, args.teps, wtNames)) continue;
      await fs.rm(path.join(dir, e), { recursive: true, force: true }).catch(() => {});
      removed.push(`${sub}/${e}`);
    }
  }

  // The branches: local always; the forge copy is asked to go and a
  // refusal is a note — credentials ride the remote, or they do not.
  for (const b of [...new Set(args.branches)]) {
    await exec("git", ["-C", args.repoRoot, "branch", "-D", b], args.repoRoot);
    removed.push(`branch ${b}`);
    const pushed = await exec(
      "git",
      ["-C", args.repoRoot, "push", "origin", "--delete", b],
      args.repoRoot,
    );
    if (pushed.code === 0) removed.push(`forge branch ${b}`);
    else if (!/remote ref does not exist|unable to delete/.test(pushed.out))
      notes.push(
        `the forge kept ${b}: ${pushed.out.trim().split("\n").pop()?.slice(0, 120) ?? "push refused"}`,
      );
  }
  args.log?.(
    `space residue: removed ${removed.length} item(s)` +
      (notes.length ? `; ${notes.length} note(s)` : ""),
  );
  return { removed, notes };
}
