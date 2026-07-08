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
  /**
   * Repo-relative files this unit **reads** but does not itself produce — the declared
   * read set (SP-6/2 AC2). Unlike `consumes` (which builds a real dependency edge), `reads`
   * is the authoring-time evidence the {@link undeclaredReadsCheck} gate audits: a read that
   * lands on a SIBLING unit's footprint with no matching `consumes` is an undeclared
   * cross-unit dependency and the slice is refused. A read of a file no sibling produces is a
   * pre-existing file and passes. Declared (not inferred from a file that may not exist yet),
   * so the gate runs at the door beside the consumes-resolvability gate.
   */
  reads?: string[];
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

// ── Undeclared cross-unit read (SP-6/2 AC2) ────────────────────────────────
//
// `consumes` declares a real dependency edge; `reads` declares a file a unit
// merely *reads*. The hole this closes: a unit reads a file ANOTHER unit in the
// same Spec produces but declares no `consumes` for it — an undeclared cross-unit
// dependency. The scheduler then sees no edge and may dispatch the reader before
// the producer has landed, so the reader reads a stale/absent file (the prose-note
// dependency that slipped through and caused the SL-1/SL-2 stub-and-`rm` deletion).
//
// The gate is pure and **declared**: each unit lists the files it `reads:`; the
// check compares those against sibling productions (the same global producer map
// `buildUnitDag` builds) with **no source scan and no model call**. Any read that
// lands on a sibling's footprint with no matching `consumes` is refused, naming the
// file and its producing unit. A read of a file NO sibling produces is a pre-existing
// file and passes — the gate fences only cross-unit reads, not reads of the world.
// Because reads are *declared* (not inferred from a file that may not exist yet), it
// runs at authoring time, at the door, beside the consumes-resolvability gate.

/** One undeclared cross-unit read: `reader` reads `file`, which `producer` produces,
 *  with no `consumes` edge declaring the dependency. */
export interface UndeclaredRead {
  /** The read file that a sibling unit produces. */
  file: string;
  /** A human label for the unit that declared the read. */
  reader: string;
  /** A human label for the sibling unit whose footprint produces `file`. */
  producer: string;
}

export type UndeclaredReadResult =
  { ok: true } | { ok: false; message: string; violations: UndeclaredRead[] };

/**
 * The teaching message the undeclared-read refusal names (SP-6/2 AC2). Exported so
 * the refusal (in `create_slice`) and the test assert against **this constant**, not
 * a duplicated literal — a shared message is itself a contract, and a hardcoded copy
 * drifts the moment one side is reworded (the `/promote_tep/` lesson). The specific
 * file + producing unit are appended per-violation by {@link undeclaredReadsCheck}.
 */
export const UNDECLARED_READ_RULE_MSG =
  "Undeclared cross-unit read — a unit `reads:` a file another unit in this Spec " +
  "produces, but declares no `consumes` for it. Without the `consumes` edge the " +
  "scheduler sees no dependency and may dispatch this unit before its producer has " +
  "landed, so it reads a stale or absent file (the prose-note dependency that caused " +
  'the SL-1/SL-2 deletion). Either add `consumes: ["<that file>"]` so the dependency ' +
  "is a real edge the scheduler orders on, or — if you do not actually depend on that " +
  "unit's output — drop the file from `reads`. A read of a file no sibling unit " +
  "produces is a pre-existing file and is fine.";

/**
 * Describe a work unit for a refusal message: prefer its `note` (the task text),
 * fall back to its footprint, then to a positional `unit #<index>` handle. Pure and
 * deterministic — never throws on a missing field.
 */
function describeUnit(unit: ContractFirstWorkUnit, index: number): string {
  const note = (unit.note ?? "").trim();
  if (note) {
    // Keep the message readable — collapse whitespace and cap long notes.
    const flat = note.replace(/\s+/g, " ");
    return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
  }
  const fp = (unit.footprint ?? []).map(normalizeFilePath).filter(Boolean);
  if (fp.length) return `the unit producing [${fp.join(", ")}]`;
  return `unit #${index}`;
}

/**
 * The undeclared-cross-unit-read gate (SP-6/2 AC2). Pure check over a slice's
 * declared `work_units`: for every file a unit `reads:` that a **sibling** unit's
 * footprint **produces**, the unit must also `consumes:` it. A read of a sibling
 * production with no matching `consumes` is refused, naming the {@link UNDECLARED_READ_RULE_MSG}
 * rule plus the offending file and its producing unit. A read of a file **no** sibling
 * produces (a pre-existing file), or a read of a file in the unit's **own** footprint
 * (its own production), passes. No source scan, no model call, no I/O — fixtures in,
 * a verdict out — the deterministic analog of the prose-note dependency that slipped
 * the SL-1/SL-2 review.
 */
export function undeclaredReadsCheck(
  units: ContractFirstWorkUnit[],
): UndeclaredReadResult {
  const list = units ?? [];

  // Global producer map: normalized file → the indices of every unit producing it.
  // Mirrors `buildUnitDag`'s producer resolution (footprint = production).
  const producers = new Map<string, number[]>();
  list.forEach((u, i) => {
    for (const raw of u.footprint ?? []) {
      const f = normalizeFilePath(raw);
      if (!f) continue;
      const arr = producers.get(f) ?? [];
      arr.push(i);
      producers.set(f, arr);
    }
  });

  const violations: UndeclaredRead[] = [];
  const seen = new Set<string>();
  list.forEach((u, i) => {
    const consumed = new Set(
      (u.consumes ?? []).map(normalizeFilePath).filter(Boolean),
    );
    for (const raw of u.reads ?? []) {
      const file = normalizeFilePath(raw);
      if (!file) continue;
      // A SIBLING producer (any producing unit other than this one). A read of a
      // file this unit itself produces is its own work, not a cross-unit dependency.
      const siblingProducer = (producers.get(file) ?? []).find((p) => p !== i);
      if (siblingProducer === undefined) continue; // pre-existing file → fine
      if (consumed.has(file)) continue; // declared the dependency → fine
      const key = `${i} ${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        file,
        reader: describeUnit(u, i),
        producer: describeUnit(list[siblingProducer], siblingProducer),
      });
    }
  });

  if (violations.length === 0) return { ok: true };
  violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.reader.localeCompare(b.reader),
  );
  const message =
    UNDECLARED_READ_RULE_MSG +
    "\n" +
    violations
      .map(
        (v) =>
          `  • ${v.reader} reads ${v.file}, which ${v.producer} produces — add ` +
          `\`consumes: ["${v.file}"]\` or drop it from \`reads\`.`,
      )
      .join("\n");
  return { ok: false, message, violations };
}

// ── Acceptance-evidence path convention (SP-6/6 AC2) ───────────────────────
//
// Mechanism 5 holds the exam out of the implementer's reach: the acceptance
// probes the closing gate runs are authored by the held-out verifier at
// spec/slice time and committed to a reserved location — by convention, any path
// with an `acceptance/` directory segment (e.g. `tests/acceptance/foo.test.ts`,
// `.tandem/acceptance/SP-6.test.ts`). The footprint resolver below treats such a
// path as **never-in-footprint**: no unit can own it, so SP-2's post-tool diff
// ({@link footprintContainment}) flags any create/modify/delete that lands there
// — regardless of what the unit *declared* — and the worker is aborted to
// requires-attention rather than producing a green it authored. This is the
// deterministic analog of "the student cannot write the answer key." Pure: a
// path-shape convention, no I/O; both the pre-tool guard and the post-tool check
// route through {@link isAcceptanceEvidencePath} so the rule can't drift.

/**
 * The default convention marking a path as held-out acceptance evidence: any
 * `acceptance` directory segment (anchored to a path boundary, case-insensitive),
 * so `acceptance/x`, `tests/acceptance/x`, and `.tandem/acceptance/x` all match
 * while an `acceptanceFoo.ts` file does not. Exported so callers (`create_slice`,
 * the footprint resolver, the tests) name the convention via this constant rather
 * than re-deriving the regex.
 */
export const ACCEPTANCE_EVIDENCE_RE = /(?:^|\/)acceptance(?:\/|$)/i;

/** Options for the acceptance-evidence convention (override the default shape). */
export interface AcceptanceEvidenceOpts {
  /**
   * Override the predicate deciding whether a (normalized, repo-relative) path is
   * held-out acceptance evidence. Defaults to {@link ACCEPTANCE_EVIDENCE_RE}.
   */
  isAcceptanceEvidence?: (file: string) => boolean;
}

/**
 * Whether `p` is a held-out acceptance-evidence path (SP-6/6 AC2) — the evidence
 * the independent grader runs, which **no unit may own or touch**. Normalizes the
 * path first so `./acceptance/x` and `acceptance/x` agree. Static-only: a path-shape
 * decision, never a filesystem query.
 */
export function isAcceptanceEvidencePath(
  p: string,
  opts?: AcceptanceEvidenceOpts,
): boolean {
  const file = normalizeFilePath(p);
  if (!file) return false;
  const predicate = opts?.isAcceptanceEvidence;
  return predicate ? predicate(file) : ACCEPTANCE_EVIDENCE_RE.test(file);
}

/**
 * The footprint resolver (SP-6/6 AC2): strip acceptance-evidence paths from a
 * declared footprint so they are **never-in-footprint**. A unit cannot claim the
 * held-out evidence by listing it in `files:`/`footprint:` — the resolver drops it,
 * leaving the path unowned so {@link footprintGuard} denies a write to it and
 * {@link footprintContainment} flags a change there. Returns the remaining paths
 * unchanged (un-normalized); callers normalize as they already do.
 */
export function resolveFootprint(
  footprint: string[],
  opts?: AcceptanceEvidenceOpts,
): string[] {
  return (footprint ?? []).filter((f) => !isAcceptanceEvidencePath(f, opts));
}

/** The independent-verification role of a work/execution unit (SP-6/7 AC1). */
export type UnitRole = "code" | "test";

/**
 * Resolve a unit's **effective footprint by role** (SP-6/7 AC1) — the role-vs-held-out split.
 *
 *   • A `code` unit (the default) OWNS the ordinary source it declares and can **never** own the
 *     held-out `acceptance/` evidence: {@link resolveFootprint} strips every acceptance path, so a
 *     code-author cannot author the probe it is graded on.
 *   • A `test` unit is the held-out verifier: its footprint is **exactly** the acceptance-evidence
 *     paths it declares (the inverse filter — keep only what {@link isAcceptanceEvidencePath} matches).
 *     So the test-author owns the `acceptance/` probe and nothing else, and the grade it authors lies
 *     outside every code-author's footprint (the independence AC4 relies on).
 *
 * Pure — a path-shape decision, no I/O. Paths are returned un-normalized (callers normalize as they
 * already do), mirroring {@link resolveFootprint}.
 */
export function resolveRoleFootprint(
  role: UnitRole | undefined,
  footprint: string[],
  opts?: AcceptanceEvidenceOpts,
): string[] {
  if (role === "test")
    // Tests-first (2026-07-08): the test role owns ALL tests — the held-out acceptance
    // probes AND ordinary `*.test.*` files (e.g. updating an existing unit test to a
    // changed contract). A code unit still owns neither (stripped below + codeTestFence).
    return (footprint ?? []).filter(
      (f) =>
        isAcceptanceEvidencePath(f, opts) || /\.test\.[cm]?[jt]sx?$/.test(f),
    );
  return resolveFootprint(footprint, opts);
}

// ── Footprint enforcement (SP-tgs8nz_SL-6: the PreToolUse guard) ────────────
//
// An orchestrated worker runs under `bypassPermissions` (no prompts), so a
// PreToolUse hook is the guardrail: it **denies** an Edit/Write/MultiEdit to a
// file outside the worker's declared footprint. Pure decision — the SDK hook
// callback (in OrchestratorService) and the shell `ownership-guard.mjs` both
// call this; fixtures in, allow/deny out.

const GUARDED_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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
 * (SP-tgs8nz_SL-6). Only the write tools — `Edit`/`Write`/`MultiEdit`/`NotebookEdit` — are
 * guarded; anything else, and a call with no target path, is allowed (the hook fences
 * *writes*, not reads/Bash). A write to a file **outside** the declared footprint is
 * **denied**, naming it — so a stray write surfaces immediately instead of corrupting
 * another unit's files.
 */
export function footprintGuard(
  toolName: string,
  toolInput: unknown,
  footprint: string[],
  repoRoot: string,
  opts?: AcceptanceEvidenceOpts,
): FootprintDecision {
  if (!GUARDED_TOOLS.has(toolName)) return { allow: true };
  // NotebookEdit carries its target as `notebook_path`; the rest use `file_path`.
  const inp = toolInput as { file_path?: unknown; notebook_path?: unknown };
  const fp = typeof inp?.file_path === "string" ? inp.file_path : inp?.notebook_path;
  if (typeof fp !== "string" || !fp.trim()) return { allow: true };
  const target = relToRepo(fp, repoRoot);
  // The caller passes the ROLE-EFFECTIVE footprint (`resolveRoleFootprint`, SP-6/7): a
  // `test` unit's footprint IS its held-out `acceptance/` probe(s); a `code` unit's has every
  // acceptance path stripped. Honor it directly — do NOT re-strip here — so the held-out
  // verifier can author the very probe it owns, while a code-author (whose role footprint
  // excludes acceptance) still cannot. (Pre-SP-6/7 this hard-denied ANY acceptance write,
  // which also fenced out the legitimate test-author — the bug this fixes.)
  const owned = footprint.map(normalizeFilePath);
  if (owned.includes(target)) return { allow: true };
  // Not owned → a terse, generic refusal. Deliberately NOT naming "held-out grading evidence" or an
  // "independent verifier" even for an acceptance/ target (SP-6/7): the deny must not teach the
  // worker the independence mechanism it would then reason about or try to game — it just knocks its
  // head on the footprint boundary and adjusts. (A code-author's role footprint already excludes
  // acceptance/, so it lands here for a probe write, indistinguishable from any out-of-footprint one.)
  return {
    allow: false,
    reason:
      `Out-of-footprint write: ${target} is not in this unit's declared footprint ` +
      `[${owned.join(", ") || "(none)"}]. Edit only your footprint; if you genuinely ` +
      `need another file, stop and state the question rather than editing it.`,
  };
}

/**
 * Read scoping for a `role: code` worker (SP-6/7 — the *reverse*-leak closure). Structural
 * independence puts the TESTER in its own base-commit snapshot, so the tester can't read the
 * implementation; this fence closes the other direction: once the finished probes are copied
 * into the code worktree for the gate (and during rework rounds after that), a re-dispatched
 * code worker must not read the grading assertions and code-to-the-test. Deny a `Read` whose
 * target is a held-out acceptance-evidence path; everything else is untouched. Terse on
 * purpose — like the write-fence, the deny must not teach the grading mechanism.
 */
export function codeReadFence(
  toolName: string,
  toolInput: unknown,
  repoRoot: string,
  opts?: AcceptanceEvidenceOpts,
): FootprintDecision {
  if (toolName !== "Read") return { allow: true };
  const raw = (toolInput as { file_path?: unknown })?.file_path;
  if (typeof raw !== "string" || !raw.trim()) return { allow: true };
  const target = relToRepo(raw.trim(), repoRoot);
  if (!isAcceptanceEvidencePath(target, opts)) return { allow: true };
  return {
    allow: false,
    reason:
      `Out-of-scope read: ${target} is not part of this unit's task. Work from your ` +
      `footprint and the task context; if you genuinely need it, stop and state the question.`,
  };
}

/**
 * Tests-first belt (repair window, 2026-07-08): a `role: code` worker never touches tests.
 * Two prongs, both terse and mechanism-silent like the fences above:
 *  - a WRITE (Edit/Write/MultiEdit/NotebookEdit) targeting any test file — `*.test.*` or an
 *    `acceptance/` path — is denied regardless of footprint (test authorship is another
 *    role's job, always);
 *  - when the verify oracle is wired (`oracleWired`), a BASH command that reaches for test
 *    files, a tester snapshot (`…-test/`), or the build/test toolchain (npm/npx/tsc/test
 *    runners) is denied too — the oracle is the coder's whole feedback loop, and the
 *    worktree deliberately has no toolchain for it.
 * Pure decision; the SDK PreToolUse hook calls it for code units only.
 */
export function codeTestFence(
  toolName: string,
  toolInput: unknown,
  oracleWired: boolean,
): FootprintDecision {
  const TEST_PATH = /(^|\/)acceptance\/|\.test\.[cm]?[jt]sx?$/;
  if (GUARDED_TOOLS.has(toolName)) {
    const inp = toolInput as { file_path?: unknown; notebook_path?: unknown };
    const fp =
      typeof inp?.file_path === "string" ? inp.file_path : inp?.notebook_path;
    if (typeof fp === "string" && TEST_PATH.test(fp.trim()))
      return {
        allow: false,
        reason:
          `Out-of-scope write: ${fp.trim()} is a test file, which is not part of this ` +
          `unit's task. Implement within your footprint; if you believe a test must ` +
          `change, stop and state the question.`,
      };
    return { allow: true };
  }
  if (oracleWired && toolName === "Bash") {
    const cmd = (toolInput as { command?: unknown })?.command;
    if (typeof cmd !== "string" || !cmd.trim()) return { allow: true };
    const reachesTests =
      /(^|[\s/'"`(=])acceptance\//.test(cmd) ||
      /\.test\.[cm]?[jt]sx?\b/.test(cmd) ||
      /-test\//.test(cmd);
    const runsToolchain =
      /(^|[\s;&|(])(npm|npx|yarn|pnpm|tsc)(\s|$)/.test(cmd) ||
      /\bnode\s+--test\b/.test(cmd) ||
      /(^|[\s;&|(])(vitest|jest|mocha|pytest)(\s|$)/.test(cmd) ||
      /\b(cargo|go)\s+test\b/.test(cmd);
    if (reachesTests || runsToolchain)
      return {
        allow: false,
        reason:
          `Out-of-scope command: builds, test runs and test files are not part of this ` +
          `unit's task — call the verify tool for feedback instead. If you genuinely ` +
          `need this command, stop and state the question.`,
      };
  }
  return { allow: true };
}

// ── Bash-inclusive post-tool footprint containment (SP-6/2 AC3) ─────────────
//
// The PreToolUse `footprintGuard` above fences only Edit/Write/MultiEdit — tools
// that expose a `file_path` to pre-screen. A worker under `bypassPermissions` can
// still route a corrupting change through **Bash** (`cat > f`, `rm`, `mv`,
// `sed -i`, a `>`/`>>` redirect), which carries no `file_path`, so the pre-tool
// guard can't see it (the stub-and-`rm` deletion that motivated SP-6/2). The
// authority is therefore a **post-tool working-tree check**: after each tool call
// (Bash included), diff the worktree with `git status --porcelain` and surface any
// create/modify/delete that landed OUTSIDE the unit's declared footprint —
// regardless of which tool produced it. Pure: porcelain text + footprint in, the
// out-of-footprint changes out. The caller (`OrchestratorService.runViaSdk`) aborts
// the `query()` and reverts only the offending path(s) on a non-empty result.

/** What kind of change git observed for an out-of-footprint path. */
export type ContainmentChange = "create" | "modify" | "delete" | "rename";

export interface ContainmentViolation {
  /** Normalized repo-relative path changed outside the unit's footprint. */
  file: string;
  /** The kind of change git reported for it (informational; any kind is a violation). */
  change: ContainmentChange;
}

export type ContainmentResult =
  | { ok: true }
  | { ok: false; reason: string; violations: ContainmentViolation[] };

/**
 * Cross-unit attribution context for {@link footprintContainment} (SP-2 / TEP-6 AC4).
 * The post-tool diff git hands the check is a WHOLE-TREE diff of the shared worktree —
 * so it also sees every *other* running unit's (and earlier units') legitimate, in-their-
 * own-footprint changes. Without this context the check misattributes those to THIS unit
 * and reverts a sibling's work (the mutual-destruction failure). These two sets fence the
 * check to changes this unit actually left outside its own footprint AND outside every
 * running unit's footprint AND not already present before it started.
 */
export interface ContainmentContext {
  /**
   * The UNION of every currently-running unit's footprint files (this unit's included is
   * harmless — its own footprint is already owned). A changed path inside `running` is a
   * concurrent sibling's in-footprint work in the shared tree, never this unit's violation.
   */
  running?: string[];
  /**
   * The set of paths already dirty when THIS unit started — earlier units' already-present
   * changes the unit inherited. A changed path in `baseline` predates this unit's run, so
   * it can't be a change this unit left and is never a violation.
   */
  baseline?: string[];
}

/**
 * Decode a path as `git status --porcelain` may emit it: when a path contains
 * special characters (or `core.quotepath` is on) git wraps it in double quotes and
 * C-style-escapes the contents. Best-effort: strip the surrounding quotes and undo
 * the common `\\`, `\"`, `\n`, `\t`, … and octal `\NNN` escapes. An unquoted path
 * is returned unchanged.
 */
function unquotePorcelainPath(p: string): string {
  let t = p.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1);
    const SIMPLE: Record<string, string> = {
      "\\": "\\",
      '"': '"',
      a: "\x07",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    t = t
      .replace(/\\([0-7]{3})/g, (_m, o: string) =>
        String.fromCharCode(parseInt(o, 8)),
      )
      .replace(/\\(.)/g, (_m, c: string) => SIMPLE[c] ?? c);
  }
  return t;
}

/**
 * Classify a porcelain status pair (`XY`) into a coarse change kind. Untracked
 * (`??`) is a create; otherwise the highest-signal code wins (rename → delete →
 * add/copy create → modify). The exact label is informational — for containment,
 * any kind outside the footprint is a violation.
 */
function classifyPorcelainChange(xy: string): ContainmentChange {
  const codes = xy.replace(/\s/g, "");
  if (codes.includes("?")) return "create";
  if (codes.includes("R")) return "rename";
  if (codes.includes("D")) return "delete";
  if (codes.includes("A") || codes.includes("C")) return "create";
  return "modify"; // M (modified), T (type change), U (unmerged), …
}

/**
 * The Bash-inclusive post-tool containment check (SP-6/2 AC3). Given a unit's
 * declared `footprint` and the working-tree diff as `git status --porcelain` text,
 * return every create/modify/delete whose path falls **outside** the footprint —
 * the changes a worker must not have made, no matter which tool made them (Edit,
 * Write, or a Bash `rm`/`mv`/`sed -i`/redirect the pre-tool guard can't see).
 *
 * Paths are repo-relative on both sides (porcelain is repo-root-relative), compared
 * after {@link normalizeFilePath}. A change whose path IS in the footprint is the
 * unit's own work and is allowed — including a deletion of a footprint file, since
 * containment fences changes *outside* the footprint, never within it. Rename/copy
 * lines (`ORIG -> DEST`) are split into their endpoints so a footprint file moved
 * *out* surfaces its new (out-of-footprint) destination. Pure — no I/O; the caller
 * runs `git` and acts on the verdict (abort + revert only these paths).
 *
 * With the optional {@link ContainmentContext} (SP-2 / TEP-6 AC4), a changed path is a
 * violation ONLY when it is outside this unit's `footprint` AND outside `ctx.running`
 * (every currently-running unit's footprint — a concurrent sibling's in-footprint work)
 * AND not in `ctx.baseline` (paths already dirty when this unit started). With the
 * context absent, behaviour is exactly as before: any path outside `footprint` is flagged.
 *
 * Held-out acceptance evidence ({@link isAcceptanceEvidencePath}, overridable via
 * `opts`) is never-in-footprint (SP-6/6 AC2): it is stripped from every exemption set
 * and a change touching it is ALWAYS a violation — so a worker that writes the grader
 * it is judged on is aborted to requires-attention, never granted a green it authored.
 */
export function footprintContainment(
  porcelain: string,
  footprint: string[],
  ctx?: ContainmentContext,
  opts?: AcceptanceEvidenceOpts,
): ContainmentResult {
  // Owned = THIS unit's declared (role-effective) footprint; running = the run-level union of every
  // dispatched unit (finished + in-flight); baseline = paths already dirty at unit start. SP-6/7: a
  // held-out `acceptance/` probe IS owned by its `role: test` unit — so DON'T strip acceptance here.
  // It is exempt (below) ONLY via `owned` (the unit that authored it), never via a sibling (`running`)
  // or `baseline`, so a code-author can't slip its own grader in through the shared-tree union.
  const owned = new Set(footprint.map(normalizeFilePath).filter(Boolean));
  const running = new Set(
    (ctx?.running ?? []).map(normalizeFilePath).filter(Boolean),
  );
  const baseline = new Set(
    (ctx?.baseline ?? []).map(normalizeFilePath).filter(Boolean),
  );
  const violations: ContainmentViolation[] = [];
  const seen = new Set<string>();

  for (const rawLine of (porcelain ?? "").split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;

    // Well-formed porcelain v1: two status chars (`XY`), a space, then the path.
    const xy = line.slice(0, 2);
    const pathPart = line.slice(2).replace(/^\s+/, "");
    if (!pathPart) continue;
    const change = classifyPorcelainChange(xy);
    const codes = xy.replace(/\s/g, "");

    // Rename/copy carry `ORIG -> DEST`. A rename changes both endpoints (orig is
    // deleted, dest created); a copy only creates dest (orig is untouched).
    const arrow = pathPart.indexOf(" -> ");
    const entries: Array<{ path: string; change: ContainmentChange }> = [];
    if (arrow !== -1 && (codes.includes("R") || codes.includes("C"))) {
      const orig = pathPart.slice(0, arrow);
      const dest = pathPart.slice(arrow + 4);
      if (codes.includes("R")) entries.push({ path: orig, change: "rename" });
      entries.push({
        path: dest,
        change: codes.includes("R") ? "rename" : "create",
      });
    } else {
      entries.push({ path: pathPart, change });
    }

    for (const e of entries) {
      const file = normalizeFilePath(unquotePorcelainPath(e.path));
      if (!file || seen.has(file)) continue;
      // A change is exempt when it lands in this unit's own footprint, a concurrent/finished
      // sibling's (`running` = the run-level union), or was already dirty (`baseline`). SP-6/7: an
      // `acceptance/` probe is treated like ANY path here — the held-out test-authors run
      // concurrently in the shared worktree, each writing its OWN probe, so a sibling's probe is in
      // the union and MUST be exempt (else every test-author reverts its siblings'). A code-author
      // still cannot Write/Edit an `acceptance/` path — the per-unit PRE-tool footprint fence
      // (`footprintGuard` over its role footprint, which strips acceptance) blocks that; only a
      // deliberate Bash-write would slip the union, an accepted narrow residual.
      if (owned.has(file) || running.has(file) || baseline.has(file)) continue;
      seen.add(file);
      violations.push({ file, change: e.change });
    }
  }

  if (violations.length === 0) return { ok: true };
  violations.sort((a, b) => a.file.localeCompare(b.file));
  const reason =
    "Out-of-footprint change after a tool call — this unit's run left changes in " +
    "the working tree outside its declared footprint " +
    `[${[...owned].sort().join(", ") || "(none)"}]:\n` +
    violations.map((v) => `  • ${v.change} ${v.file}`).join("\n") +
    "\nThe orchestrator aborts this unit, restores only these paths, and marks it " +
    "requires-attention — this is terminal, not a recoverable deny. Edit only your " +
    "footprint; do not route changes through Bash (rm/mv/sed/redirect) to evade the guard.";
  return { ok: false, reason, violations };
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
