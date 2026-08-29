/**
 * A run touches its own tree and nothing else.
 *
 * A run works across several trees at once — the checkout it was started
 * from, its own worktree, one runner worktree per slice — and links them
 * together to avoid installing the same dependencies twenty times. Every
 * link is a path out of the tree a command believes it is confined to, and
 * the destructive commands do not ask: `npm ci` deletes a dependency store
 * before filling it, and a store that is a link into the checkout is
 * deleted THROUGH, leaving the person's own tree empty and every later
 * command there failing for a reason nothing on screen explains.
 *
 * So ownership is decided before anything is destroyed, on the RESOLVED
 * path, and the answer is one of three:
 *
 *   own      — inside the run's tree; the run may do as it likes
 *   borrowed — a link pointing out; the LINK may be removed, never followed
 *   foreign  — a real path outside; refused, and said
 *
 * The rule reads the filesystem rather than the string, because a string
 * cannot tell a directory from a doorway.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type Ownership = "own" | "borrowed" | "foreign" | "absent";

/** Whose is this path, from where the run stands? */
export async function ownershipOf(root: string, target: string): Promise<Ownership> {
  const link = await fs.lstat(target).catch(() => undefined);
  if (!link) return "absent";
  const inside = (p: string): boolean => {
    const rel = path.relative(path.resolve(root), path.resolve(p));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  if (link.isSymbolicLink()) {
    const to = await fs.realpath(target).catch(() => undefined);
    // A link whose target is gone is still the run's own doorway to remove.
    return to && inside(to) ? "own" : "borrowed";
  }
  return inside(target) ? "own" : "foreign";
}

/**
 * Remove something the run put there, and nothing else.
 *
 * A borrowed store is UNLINKED — the doorway goes, what is behind it is
 * untouched. A real directory inside the run's tree is removed whole. A
 * real path outside is refused: no run has business deleting it, and the
 * refusal is returned rather than thrown so a caller can say it plainly.
 */
export async function removeOwned(
  root: string,
  target: string,
): Promise<{ removed: Ownership; refused?: string }> {
  const owner = await ownershipOf(root, target);
  if (owner === "absent") return { removed: "absent" };
  if (owner === "foreign")
    return {
      removed: "foreign",
      refused: `${target} is outside this run's tree — a run never deletes what it does not own`,
    };
  if (owner === "borrowed") {
    // unlink, NEVER rm: rm would follow into the lender.
    await fs.unlink(target).catch(() => {});
    return { removed: "borrowed" };
  }
  await fs.rm(target, { force: true, recursive: true }).catch(() => {});
  return { removed: "own" };
}

/**
 * Make a tree safe to install into, and say what was in the way.
 *
 * An installer deletes a dependency store before filling it. While any
 * store is a link out of this tree, that delete lands in somebody else's.
 * Every borrowed store is unlinked first; the install then creates a real
 * one of its own. Returns what was unlinked, so the run can say it.
 */
export async function releaseBorrowed(
  root: string,
  stores: readonly string[],
): Promise<string[]> {
  const freed: string[] = [];
  for (const rel of stores) {
    const at = path.join(root, rel);
    if ((await ownershipOf(root, at)) !== "borrowed") continue;
    await fs.unlink(at).catch(() => {});
    freed.push(rel);
  }
  return freed;
}
