/**
 * Pure id helpers — no vscode, so allocation + parsing stay unit-testable
 * (ThinkubeStore itself imports vscode and can't run under node:test).
 *
 * Ids are bare sequential integers (`TEP-n`, `SP-m`, `SL-k`) namespaced by the
 * directory they live in . Each scope owns its own
 * counter, allocated **scan-max+1** over the existing children: the next number
 * is one past the highest `PREFIX-<int>` already on disk. Archive-don't-delete
 * keeps every number claimed by a file/dir, so a retired entry's number stays
 * reserved (reading the directory still counts it) and a number is never reused.
 *
 * Allocation assumes a SINGLE writer per (thinking space, org): the `<org>` directory is
 * what makes concurrent maintainers safe, not locking. A bare integer id is
 * unique only within its scope; cross-thinking space references must be fully qualified.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";


/**
 * Scan-max+1 core. Given a list of directory entry names and a prefix, return
 * one past the highest `PREFIX-<int>` among them, or `1` when none match. Pure:
 * the caller supplies the names, so the max logic is testable without fs.
 *
 * A name counts when it is exactly `PREFIX-<int>` (a `TEP-n` / `SP-m` folder) or
 * `PREFIX-<int>.md` (an `SL-k.md` slice file). Anything else — `tep.md`,
 * `spec.md`, a flattened handle like `SP-1_SL-1`, or a legacy slugged name — is
 * ignored, so unrelated siblings never perturb the counter. The highest number
 * wins (not the count), so a gap left by a deleted/retired entry is preserved.
 */
export function nextNumberFromNames(names: string[], prefix: string): number {
  const re = new RegExp(`^${prefix}-(\\d+)(?:\\.md)?$`);
  let max = 0;
  for (const name of names) {
    const m = re.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Read a directory's entry names, treating a missing directory as empty (a
 *  scope with nothing minted yet allocates `1`). */
async function readNames(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Scan-max+1 over the children of `dir` for `prefix`. */
async function nextNumberIn(dir: string, prefix: string): Promise<number> {
  return nextNumberFromNames(await readNames(dir), prefix);
}

/**
 * Next sequential TEP number for a (thinking space, org): scan-max+1 over
 * `<thinkingSpaceDir>/<org>/teps`. The first TEP in a scope is `1` and the next is `2`;
 * a different (thinking space, org) has its own `teps` directory and so restarts at `1`.
 */
export async function nextTepNumber(
  thinkingSpaceDir: string,
  org: string,
): Promise<number> {
  return nextNumberIn(path.join(thinkingSpaceDir, org, "teps"), "TEP");
}

/**
 * Next sequential spec number scoped to one TEP: scan-max+1 over the `SP-*`
 * children of `tepDir`. Each TEP folder has its own counter, so spec numbering
 * restarts at `1` under every TEP.
 */
export async function nextSpecNumber(tepDir: string): Promise<number> {
  return nextNumberIn(tepDir, "SP");
}

/**
 * Next sequential slice number scoped to one spec: scan-max+1 over the `SL-*.md`
 * children of `specDir`. Archive-aware — a retired slice's `SL-k.md` file stays
 * on disk, so reading the directory keeps its number reserved and the next
 * slice is still `max + 1` (a retired number is never reused).
 */
export async function nextSliceNumber(specDir: string): Promise<number> {
  return nextNumberIn(specDir, "SL");
}
