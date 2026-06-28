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
 * *concurrency*, not on the whole thinking space.
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
  { ok: true } | { ok: false; reason: string; conflicts: FileConflict[] };

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
  requires: string[];
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
 * pure and deterministic: **dep-resolution** (every `requires` id is a node in
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
    for (const d of n.requires ?? [])
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
  const adj = new Map(nodes.map((n) => [n.id, n.requires ?? []]));
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
      reason:
        "Dependency cycle — the DAG must be acyclic:\n  • " + cycle.join(" → "),
      cycle,
    };
  }

  return { ok: true };
}

// ── Contract-first slicing (SP-th4wqi: the contract node) ──────────────────
//
// `buildUnitDag`/`readyFrontier` sequence only on shared *footprint*; work units
// with **disjoint** footprints are treated as independent and fan out fully
// parallel. But disjoint files can still share a **contract** — an interface,
// name, schema, key, message or registration — and when a producer/consumer/test
// cluster fans out with no coordination, each worker invents that contract and
// they diverge (the SP-D / SP-th4wqe AC#3 double-red: the `ctx.promoteLocator`
// seam and the `/promote_tep/` message at once).
//
// The remedy is **contract-first**: author the shared contract as one unit, and
// have every implementer + the test declare `depends_on` that **contract node**
// (never on each other — so they stay mutually parallel). At `create_slice` time
// the work-unit files don't exist yet, so this gate can't parse imports; it acts
// only on declared work_unit *structure*. Its enforceable trigger is the
// high-confidence **unsequenced-integration** heuristic: a `*.test.*` /
// declared-integration unit running `fan-out` with **no `depends_on`**, beside
// ≥1 sibling implementation unit. A per-unit **opt-out flag** accepts a
// genuinely-independent test (the escape hatch against false positives).
//
// This file is the **contract node** for the gate itself: `create_slice` (the
// producer) and the AC test (the consumer) both import the shape, the check and
// the teaching message from here — no consumer redefines them, so the rule and
// its message can't drift (the `/promote_tep/` lesson: assert via the exported
// constant, never a hardcoded copy).

/**
 * The per-unit opt-out field name on a work_unit. A unit carrying
 * `contract_first_optout: true` is exempt from {@link contractFirstCheck} — the
 * escape hatch for a genuinely-independent test that shares no contract with its
 * siblings, so the unsequenced-integration heuristic's false positives stay
 * unblockable by hand. Exported so the `create_slice` work_unit schema and the
 * test name the field via this constant rather than a hardcoded string.
 */
export const CONTRACT_FIRST_OPTOUT_FIELD = "contract_first_optout" as const;

/**
 * The shape of a declared work_unit as the contract-first gate sees it — the
 * single source `create_slice` (schema/handler) and the AC test both import.
 * Mirrors the on-disk `work_units[]` frontmatter (`footprint`, `consumes?`,
 * `execution`, `note?`) plus the contract-first opt-out flag this spec adds.
 */
export interface ContractFirstWorkUnit {
  /** Repo-relative files/objects this unit touches — the parallelism footprint. */
  footprint: string[];
  /**
   * Repo-relative files this unit **reads/depends on** that a SIBLING unit produces —
   * the contract-first reference. Naming a sibling's footprint here both satisfies the
   * contract-first gate (the unit is coordinated through that contract, not fanned out
   * blind) and is resolved by `buildUnitDag` into a real dependency edge on the producing
   * unit. It is a file, not a node-id, so it is authorable at create time (the slice has
   * no number yet) — the fix for the unsequenced-integration deadlock.
   */
  consumes?: string[];
  /** serial (coupled) | mechanize (uniform data-parallel) | fan-out (heterogeneous). */
  execution: "serial" | "mechanize" | "fan-out";
  /** The unit's task text — what this unit does. */
  note?: string;
  /**
   * Opt out of the contract-first check: assert this fan-out test/integration
   * unit is genuinely independent (shares no contract with its siblings) so the
   * missing `consumes` is intentional, not an unsequenced-integration mistake.
   */
  contract_first_optout?: boolean;
}

/** Options for {@link contractFirstCheck}. */
export interface ContractFirstOpts {
  /**
   * Override the predicate deciding whether a unit is a test/integration unit
   * (the gate's trigger class). Defaults to {@link isIntegrationUnit} — any
   * footprint path matching `*.test.*` / `*.spec.*` / an `integration` segment.
   */
  isIntegrationUnit?: (unit: ContractFirstWorkUnit) => boolean;
}

export type ContractFirstResult =
  | { ok: true }
  | { ok: false; message: string; offendingUnit: ContractFirstWorkUnit };

/**
 * The teaching message the contract-first refusal names. Exported so the
 * refusal (in `create_slice`) and the test assert against **this constant**, not
 * a duplicated literal — the `/promote_tep/` lesson: a shared message is itself a
 * contract; if the test hardcodes its own copy, the two drift the moment one
 * side is reworded.
 */
export const CONTRACT_FIRST_RULE_MSG =
  "Contract-first slicing — define the shared contract before fanning out. " +
  "This is a `*.test.*`/integration `fan-out` unit with no `consumes`, placed " +
  "beside sibling implementation units. Fanned out unsequenced, each worker will " +
  "invent the shared contract (interface, name, schema, key, message, " +
  "registration) on its own and they will diverge. Author the contract as one " +
  "unit (a sibling whose footprint is the shared file) and route this test AND each " +
  'implementer through it: add `consumes: ["<that file>"]` to each — the contract-' +
  "first reference. The implementers depend only on the contract, never on each other, " +
  "so the fan-out is preserved (no producer→consumer→test serialization). `consumes` " +
  "names a file (not a node-id), so it is authorable here even though the slice has no " +
  "number yet. If this test is genuinely independent and shares no contract with its " +
  `siblings, set \`${CONTRACT_FIRST_OPTOUT_FIELD}: true\` on the unit to bypass this check.`;

/** Matches a footprint path that marks a unit as a test / integration unit. A
 *  `.test.`/`.spec.`/`.integration.` marker only counts when it sits on a JS/TS
 *  **source** file — so a config like `tsconfig.test.json` is NOT a test unit. */
const TEST_OR_INTEGRATION_RE =
  /(?:\.(?:test|spec|integration)\.[cm]?[jt]sx?$|(?:^|\/)integration(?:[./]|$))/i;

/**
 * Default {@link ContractFirstOpts.isIntegrationUnit}: a unit is a test /
 * integration unit when any of its footprint paths looks like a test or
 * integration file (`*.test.*`, `*.spec.*`, `*.integration.*`, or an
 * `integration` path segment). Static-only — it reads declared structure, never
 * file contents (the gate runs before the files exist).
 */
export function isIntegrationUnit(unit: ContractFirstWorkUnit): boolean {
  return (unit.footprint ?? []).some((f) =>
    TEST_OR_INTEGRATION_RE.test(normalizeFilePath(f)),
  );
}

/**
 * The contract-first gate (SP-th4wqi, AC#1–3). Pure check over a slice's
 * declared `work_units`: refuse the **unsequenced-integration** structure — a
 * `*.test.*`/integration unit running `fan-out`, with **no `consumes`**, beside
 * **≥2** sibling implementation (producer) units — naming the rule ({@link CONTRACT_FIRST_RULE_MSG})
 * and returning the offending unit, **unless** that unit carries the
 * {@link CONTRACT_FIRST_OPTOUT_FIELD} opt-out flag. A unit that declares any
 * `consumes` of a sibling's file (the contract-first remedy: a shared contract file)
 * passes — this gate refuses the *undeclared* case and lets `buildUnitDag`'s
 * acyclicity/parallelism rules handle the rest. No I/O: fixtures in, a verdict out.
 */
export function contractFirstCheck(
  units: ContractFirstWorkUnit[],
  opts?: ContractFirstOpts,
): ContractFirstResult {
  const list = units ?? [];
  const isIntegration = opts?.isIntegrationUnit ?? isIntegrationUnit;
  // Sibling producer (non-test/integration) units. A contract-first divergence
  // needs ≥2 producers that could each independently (re-)invent a shared seam:
  // 0 producers → nothing to contract; 1 producer → a trivial self-contract (its
  // own unit test), idiotic to gate. The gate engages only at ≥2 producers.
  const producerCount = list.filter((u) => !isIntegration(u)).length;
  if (producerCount < 2) return { ok: true };

  for (const u of list) {
    if (u.execution !== "fan-out") continue; // only fan-out integration triggers
    if (!isIntegration(u)) continue; // only test/integration units
    if (u[CONTRACT_FIRST_OPTOUT_FIELD] === true) continue; // explicit escape hatch
    // Passes iff it declares it `consumes` a file a SIBLING unit produces — the
    // contract-first reference. That's a real contract edge (buildUnitDag resolves it),
    // authorable without the unborn slice's node-id, so it coordinates the unit.
    const consumesSibling = (u.consumes ?? []).some((c) => {
      const cf = normalizeFilePath(c);
      return list.some(
        (other) =>
          other !== u &&
          (other.footprint ?? []).some((f) => normalizeFilePath(f) === cf),
      );
    });
    if (consumesSibling) continue;
    return { ok: false, message: CONTRACT_FIRST_RULE_MSG, offendingUnit: u };
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

export type FootprintDecision =
  { allow: true } | { allow: false; reason: string };

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
 * is the thinking space-wins recovery the arbiter runs after a reload (AC3, AC5).
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
