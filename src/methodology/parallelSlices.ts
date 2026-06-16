/**
 * Parallel-slice declarations and the file-disjointness check (SP-tgpwbm /
 * TEP-tgpupa). For sibling slices to run **concurrently** in isolated
 * worktrees without merge conflicts, every member of a `parallel_group` must
 * own a **disjoint** file set. This module is the pure validator: callers
 * (`/slice`, `create_slice`, later the ownership arbiter) supply the declared
 * file sets and act on the result. No I/O — fixtures in, conflicts out.
 *
 * Only slices sharing the *same non-empty* `parallel_group` are checked against
 * each other. An ungrouped slice (no `parallel_group`) and a singleton group
 * run sequentially and can never conflict — disjointness is a constraint on
 * *concurrency*, not on the whole board.
 */

export interface ParallelSliceInput {
  /** Slice handle used to name a conflict, e.g. "SP-3_SL-2". */
  handle: string;
  /** The `parallel_group` this slice belongs to; undefined/blank → ungrouped. */
  parallelGroup?: string;
  /** Repo-relative paths the slice declares it will edit (its `files:` set). */
  files?: string[];
}

export interface FileConflict {
  /** The file claimed by more than one slice in the same parallel group. */
  file: string;
  /** The parallel_group whose members collide on `file`. */
  group: string;
  /** The slice handles that both declare it (sorted, deduped). */
  slices: string[];
}

export type ValidateParallelGroupResult =
  | { ok: true }
  | { ok: false; reason: string; conflicts: FileConflict[] };

/**
 * Normalize a declared path for comparison: trim surrounding whitespace and
 * drop a single leading `./`, so `./src/a.ts` and `src/a.ts` count as the same
 * file. Deliberately conservative — it does not resolve `..` or symlinks (the
 * declared sets are repo-relative authoring hints, not filesystem queries).
 */
export function normalizeFilePath(p: string): string {
  const t = p.trim();
  return t.startsWith("./") ? t.slice(2) : t;
}

/**
 * Refuse a `parallel_group` whose members' file sets overlap, naming the
 * conflicting files and the slices that claim them (AC1). A group with fewer
 * than two members, and any ungrouped slice, are skipped — they run
 * sequentially and disjointness does not apply.
 */
export function validateParallelGroup(
  slices: ParallelSliceInput[],
): ValidateParallelGroupResult {
  const byGroup = new Map<string, ParallelSliceInput[]>();
  for (const s of slices) {
    const g = (s.parallelGroup ?? "").trim();
    if (!g) continue;
    const arr = byGroup.get(g) ?? [];
    arr.push(s);
    byGroup.set(g, arr);
  }

  const conflicts: FileConflict[] = [];
  for (const [group, members] of byGroup) {
    if (members.length < 2) continue;
    // file → the set of slice handles in this group that declare it.
    const claimants = new Map<string, Set<string>>();
    for (const m of members) {
      for (const raw of m.files ?? []) {
        const file = normalizeFilePath(raw);
        if (!file) continue;
        const set = claimants.get(file) ?? new Set<string>();
        set.add(m.handle);
        claimants.set(file, set);
      }
    }
    for (const [file, handles] of claimants) {
      if (handles.size < 2) continue;
      conflicts.push({ file, group, slices: [...handles].sort() });
    }
  }

  if (conflicts.length === 0) return { ok: true };

  conflicts.sort(
    (a, b) => a.group.localeCompare(b.group) || a.file.localeCompare(b.file),
  );
  const reason =
    "Parallel-group file overlap — members of a parallel_group must own disjoint files:\n" +
    conflicts
      .map(
        (c) =>
          `  • parallel_group "${c.group}": ${c.slices.join(
            " and ",
          )} both claim ${c.file}`,
      )
      .join("\n");
  return { ok: false, reason, conflicts };
}
