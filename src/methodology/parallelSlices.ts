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
  /** Execution-aware work units (SP-tgs8gb); each footprint folds into the
   *  slice's claimed set, so footprint disjointness is enforced alongside `files`. */
  workUnits?: { footprint: string[] }[];
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
      const claimed = [
        ...(m.files ?? []),
        ...(m.workUnits ?? []).flatMap((w) => w.footprint ?? []),
      ];
      for (const raw of claimed) {
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

// ── Work-unit / slice DAG validation (SP-tgs8nz: deterministic control plane) ──
//
// Before any worker runs, the scheduler's DAG must be well-formed: every
// dependency resolves to a known node, and the graph is acyclic. This is pure
// graph code — no LLM in the control plane (SP-tgs8nz). `create_slice` and the
// scheduler call it to reject a malformed DAG deterministically.

export interface DagNode {
  /** Node id — a work-unit id (`SP-3_SL-2#wu-0`) or a slice handle (`SP-3_SL-2`). */
  id: string;
  /** Ids this node depends on (must all resolve to nodes in the same DAG). */
  dependsOn: string[];
}

export type ValidateDagResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      cycle?: string[];
      missing?: Array<{ node: string; dep: string }>;
    };

/**
 * Validate a work-unit / slice DAG is well-formed (SP-tgs8nz). Two checks, both
 * pure and deterministic: **dep-resolution** (every `dependsOn` id is a node in
 * the DAG — no dangling reference) and **acyclicity** (no dependency cycle; the
 * returned `cycle` names the loop). Dangling deps are reported first (a cycle
 * check over a graph with missing nodes is meaningless). Fixtures in, a verdict
 * out — the scheduler never dispatches a DAG this rejects.
 */
export function validateDag(nodes: DagNode[]): ValidateDagResult {
  const ids = new Set(nodes.map((n) => n.id));

  // 1. Dep-resolution: every dependency must name a node in the DAG.
  const missing: Array<{ node: string; dep: string }> = [];
  for (const n of nodes)
    for (const d of n.dependsOn ?? [])
      if (!ids.has(d)) missing.push({ node: n.id, dep: d });
  if (missing.length) {
    missing.sort(
      (a, b) => a.node.localeCompare(b.node) || a.dep.localeCompare(b.dep),
    );
    const reason =
      "Unresolved dependency — a node depends on an id that isn't in the DAG:\n" +
      missing
        .map((m) => `  • ${m.node} depends on ${m.dep} (not found)`)
        .join("\n");
    return { ok: false, reason, missing };
  }

  // 2. Acyclicity: DFS with GRAY/BLACK colouring; a back-edge to a GRAY node is a cycle.
  // `findCycle` RETURNS the loop path (rather than mutating a closure var) so the
  // control-flow narrowing below sees `cycle` as `string[] | null`.
  const adj = new Map(nodes.map((n) => [n.id, n.dependsOn ?? []]));
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  const stack: string[] = [];
  const findCycle = (id: string): string[] | null => {
    color.set(id, GRAY);
    stack.push(id);
    for (const d of adj.get(id) ?? []) {
      if (color.get(d) === GRAY) return stack.slice(stack.indexOf(d)).concat(d);
      if (color.get(d) === WHITE) {
        const c = findCycle(d);
        if (c) return c;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  };
  let cycle: string[] | null = null;
  for (const n of nodes) {
    if (color.get(n.id) === WHITE) {
      cycle = findCycle(n.id);
      if (cycle) break;
    }
  }
  if (cycle) {
    return {
      ok: false,
      reason: "Dependency cycle — the DAG must be acyclic:\n  • " + cycle.join(" → "),
      cycle,
    };
  }

  return { ok: true };
}

// ── Footprint enforcement (SP-tgs8nz_SL-6: the PreToolUse guard) ────────────
//
// An orchestrated worker runs under `bypassPermissions` (no prompts), so a
// PreToolUse hook is the guardrail: it **denies** an Edit/Write/MultiEdit to a
// file outside the worker's declared footprint. Pure decision — the SDK hook
// callback (in OrchestratorService) and the shell `ownership-guard.mjs` both
// call this; fixtures in, allow/deny out.

const GUARDED_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

/** Relativize an Edit/Write target to the repo root so it compares to the (repo-relative) footprint. */
function relToRepo(p: string, repoRoot: string): string {
  const root = repoRoot.replace(/\/+$/, "");
  let t = p.trim();
  if (root && t.startsWith(root + "/")) t = t.slice(root.length + 1);
  return normalizeFilePath(t);
}

export type FootprintDecision = { allow: true } | { allow: false; reason: string };

/**
 * Decide whether a worker scoped to `footprint` may run `toolName` on `toolInput`
 * (SP-tgs8nz_SL-6). Only `Edit`/`Write`/`MultiEdit` are guarded — anything else, and a
 * call with no `file_path`, is allowed (the hook fences *writes*, not reads/Bash). A
 * write to a file **outside** the declared footprint is **denied**, naming it — so a
 * stray write surfaces immediately instead of corrupting another unit's files.
 */
export function footprintGuard(
  toolName: string,
  toolInput: unknown,
  footprint: string[],
  repoRoot: string,
): FootprintDecision {
  if (!GUARDED_TOOLS.has(toolName)) return { allow: true };
  const fp = (toolInput as { file_path?: unknown })?.file_path;
  if (typeof fp !== "string" || !fp.trim()) return { allow: true };
  const target = relToRepo(fp, repoRoot);
  const owned = footprint.map(normalizeFilePath);
  if (owned.includes(target)) return { allow: true };
  return {
    allow: false,
    reason:
      `Out-of-footprint write: ${target} is not in this unit's declared footprint ` +
      `[${owned.join(", ") || "(none)"}]. Edit only your footprint; if you genuinely ` +
      `need another file, stop and state the question rather than editing it.`,
  };
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
