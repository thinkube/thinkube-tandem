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

// ── Ownership claims (SP-tgpwbm AC3 / AC5) ─────────────────────────────────
//
// The durable ownership map: each repo-relative file is owned by at most one
// slice. The ownership arbiter (src/services/OwnershipArbiter.ts) wraps this
// pure algebra with a durable store (git refs / a journal) and survives a
// window reload by rehydrating the map from disk. These functions are the
// testable core — no I/O, no clock.

/** Normalized repo-relative file → the slice handle that owns it. */
export type OwnershipState = Record<string, string>;

export type AcquireOutcome =
  | { ok: true; state: OwnershipState; acquired: string[] }
  | { ok: false; conflicts: Array<{ file: string; heldBy: string }> };

/**
 * Atomically claim `files` for `slice`. **All-or-nothing**: if any file is
 * already held by a *different* slice, the whole claim is denied and the input
 * `state` is returned untouched (the caller never persists a partial claim).
 * Re-claiming a file the same slice already owns is idempotent.
 */
export function acquireClaim(
  state: OwnershipState,
  slice: string,
  files: string[],
): AcquireOutcome {
  const norm = [...new Set(files.map(normalizeFilePath).filter(Boolean))];
  const conflicts: Array<{ file: string; heldBy: string }> = [];
  for (const f of norm) {
    const owner = state[f];
    if (owner && owner !== slice) conflicts.push({ file: f, heldBy: owner });
  }
  if (conflicts.length) {
    conflicts.sort((a, b) => a.file.localeCompare(b.file));
    return { ok: false, conflicts };
  }
  const next: OwnershipState = { ...state };
  for (const f of norm) next[f] = slice;
  return { ok: true, state: next, acquired: norm };
}

/** Release every file owned by `slice`. Returns the new state (others kept). */
export function releaseClaim(
  state: OwnershipState,
  slice: string,
): OwnershipState {
  const next: OwnershipState = {};
  for (const [f, owner] of Object.entries(state)) {
    if (owner !== slice) next[f] = owner;
  }
  return next;
}

export interface ReconcileResult {
  state: OwnershipState;
  dropped: Array<{ file: string; slice: string }>;
}

/**
 * Reconcile the durable map against the set of slices whose worktrees are still
 * live: any file owned by a slice **not** in `liveSlices` is reclaimed — its
 * holder was abandoned (e.g. its worktree was removed without releasing). This
 * is the board-wins recovery the arbiter runs after a reload (AC3, AC5).
 */
export function reconcileOwnership(
  state: OwnershipState,
  liveSlices: Iterable<string>,
): ReconcileResult {
  const live = new Set(liveSlices);
  const next: OwnershipState = {};
  const dropped: Array<{ file: string; slice: string }> = [];
  for (const [f, owner] of Object.entries(state)) {
    if (live.has(owner)) next[f] = owner;
    else dropped.push({ file: f, slice: owner });
  }
  dropped.sort((a, b) => a.file.localeCompare(b.file));
  return { state: next, dropped };
}

/** Serialize the ownership map to the durable journal format (stable key order). */
export function serializeOwnership(state: OwnershipState): string {
  const claims: OwnershipState = {};
  for (const f of Object.keys(state).sort()) claims[f] = state[f];
  return JSON.stringify({ version: 1, claims }, null, 2) + "\n";
}

/**
 * Parse a durable journal back into an ownership map (rehydrate-from-disk).
 * Tolerant: malformed JSON or an unexpected shape yields an **empty** map rather
 * than throwing, so a corrupt journal degrades to "no claims" — never a dead
 * arbiter that can't activate.
 */
export function parseOwnership(text: string): OwnershipState {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const claims = (parsed as { claims?: unknown }).claims;
      if (claims && typeof claims === "object" && !Array.isArray(claims)) {
        const out: OwnershipState = {};
        for (const [f, slice] of Object.entries(
          claims as Record<string, unknown>,
        )) {
          if (typeof slice === "string" && slice) {
            const nf = normalizeFilePath(f);
            if (nf) out[nf] = slice;
          }
        }
        return out;
      }
    }
  } catch {
    // fall through to the empty map
  }
  return {};
}

// ── Worktree-Spec recovery (SP-tgpwbm AC5) ─────────────────────────────────

/** The recovery-relevant frontmatter of one slice. */
export interface SliceRecoveryInfo {
  handle: string;
  /** Frontmatter `assignee:` — non-empty once a worktree/teammate claimed it. */
  assignee?: string;
  /** Frontmatter `status:` — ready | doing | done | archived. */
  status?: string;
}

export interface RecoverableResult {
  /** True when the Spec has orphaned, resumable work. */
  recoverable: boolean;
  /** Handles of the assignee-stamped, still-open slices with no live holder. */
  orphaned: string[];
}

/**
 * Detect an **orphaned worktree-shaped Spec** (AC5): one whose slices carry an
 * `assignee:` stamp (a worktree/teammate claimed them) and are still open, yet
 * have **no live arbiter holder** — the signature of a Spec whose worktree
 * session died (a crash / window reload) before finishing. `/pair-start` uses
 * this to offer to resume rather than starting fresh. Done and archived slices
 * never count — their work is finished, not orphaned.
 */
export function detectRecoverable(
  slices: SliceRecoveryInfo[],
  liveHolders: Iterable<string>,
): RecoverableResult {
  const live = new Set(liveHolders);
  const orphaned = slices
    .filter((s) => {
      const status = (s.status ?? "").toLowerCase();
      return (
        (s.assignee ?? "").trim() !== "" &&
        status !== "done" &&
        status !== "archived" &&
        !live.has(s.handle)
      );
    })
    .map((s) => s.handle);
  return { recoverable: orphaned.length > 0, orphaned };
}

// ── Require a worktree before working a Spec (SP-tgpwbm AC2) ────────────────

/**
 * Decide whether `/pair-start` must **open the Spec's worktree** before working,
 * or can **proceed** because it's already inside one (AC2). A Spec runs in its
 * own `spec/SP-{n}` worktree (TEP-0008); if `/pair-start` was invoked from the
 * canonical/main checkout it must redirect into the worktree session rather than
 * editing the main tree. `cwd` inside the canonical repo tree → `"open-worktree"`;
 * a linked worktree (a different path, e.g. a sibling `<repo>-worktrees/SP-{n}`)
 * → `"proceed"`. Pure — the actual open rides `WorktreeService` / SL-7/SL-8.
 */
export function requiresWorktree(
  cwd: string,
  canonicalRepo: string,
): "open-worktree" | "proceed" {
  const norm = (p: string) => p.replace(/\/+$/, "");
  const c = norm(cwd);
  const repo = norm(canonicalRepo);
  return c === repo || c.startsWith(repo + "/") ? "open-worktree" : "proceed";
}
