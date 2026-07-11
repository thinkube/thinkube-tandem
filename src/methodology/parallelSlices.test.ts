/**
 * Unit tests for the parallel-group file-disjointness validator (SP-tgpwbm
 * AC1). Pure functions over declared slice file sets — node:test + node:assert
 * are enough. Run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeFilePath,
  validateParallelGroup,
  validateDag,
  footprintGuard,
  codeReadFence,
  codeTestFence,
  acquireClaim,
  releaseClaim,
  reconcileOwnership,
  serializeOwnership,
  parseOwnership,
  detectRecoverable,
  requiresWorktree,
  footprintContainment,
  undeclaredReadsCheck,
  UNDECLARED_READ_RULE_MSG,
  isAcceptanceEvidencePath,
  resolveFootprint,
  resolveRoleFootprint,
  ACCEPTANCE_EVIDENCE_RE,
  type ParallelSliceInput,
  type OwnershipState,
  type SliceRecoveryInfo,
  type ContainmentResult,
  type ContractFirstWorkUnit,
  type UndeclaredReadResult,
} from "./parallelSlices";

test("disjoint members of a parallel_group pass", () => {
  const slices: ParallelSliceInput[] = [
    { handle: "SP-9_SL-1", parallelGroup: "core", files: ["src/a.ts"] },
    { handle: "SP-9_SL-2", parallelGroup: "core", files: ["src/b.ts"] },
  ];
  assert.equal(validateParallelGroup(slices).ok, true);
});

test("overlapping members of a parallel_group are refused, naming the file and slices", () => {
  const slices: ParallelSliceInput[] = [
    {
      handle: "SP-9_SL-1",
      parallelGroup: "core",
      files: ["src/a.ts", "src/shared.ts"],
    },
    {
      handle: "SP-9_SL-2",
      parallelGroup: "core",
      files: ["src/b.ts", "src/shared.ts"],
    },
  ];
  const r = validateParallelGroup(slices);
  assert.equal(r.ok, false);
  if (r.ok) return; // narrow for TS
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].file, "src/shared.ts");
  assert.equal(r.conflicts[0].group, "core");
  assert.deepEqual(r.conflicts[0].slices, ["SP-9_SL-1", "SP-9_SL-2"]);
  // The reason text names the conflicting file and both slices.
  assert.match(r.reason, /src\/shared\.ts/);
  assert.match(r.reason, /SP-9_SL-1/);
  assert.match(r.reason, /SP-9_SL-2/);
  assert.match(r.reason, /core/);
});

test("overlapping work-unit footprints in a parallel_group are refused", () => {
  const slices: ParallelSliceInput[] = [
    {
      handle: "SP-9_SL-1",
      parallelGroup: "core",
      workUnits: [{ footprint: ["src/a.ts", "src/shared.ts"] }],
    },
    { handle: "SP-9_SL-2", parallelGroup: "core", files: ["src/shared.ts"] },
  ];
  const r = validateParallelGroup(slices);
  assert.equal(r.ok, false);
  if (r.ok) return; // narrow for TS
  assert.equal(r.conflicts[0].file, "src/shared.ts");
  assert.deepEqual(r.conflicts[0].slices, ["SP-9_SL-1", "SP-9_SL-2"]);
});

test("overlap OUTSIDE a parallel_group is allowed — ungrouped slices run sequentially", () => {
  const slices: ParallelSliceInput[] = [
    { handle: "SP-9_SL-1", files: ["src/shared.ts"] },
    { handle: "SP-9_SL-2", files: ["src/shared.ts"] },
  ];
  assert.equal(validateParallelGroup(slices).ok, true);
});

test("a singleton group never conflicts with itself", () => {
  const slices: ParallelSliceInput[] = [
    {
      handle: "SP-9_SL-1",
      parallelGroup: "solo",
      files: ["src/a.ts", "src/a.ts"],
    },
  ];
  assert.equal(validateParallelGroup(slices).ok, true);
});

test("different parallel_groups are isolated — same file in two groups is fine", () => {
  const slices: ParallelSliceInput[] = [
    { handle: "SP-9_SL-1", parallelGroup: "g1", files: ["src/shared.ts"] },
    { handle: "SP-9_SL-2", parallelGroup: "g2", files: ["src/shared.ts"] },
  ];
  assert.equal(validateParallelGroup(slices).ok, true);
});

test("path normalization: ./src/a.ts collides with src/a.ts in the same group", () => {
  const slices: ParallelSliceInput[] = [
    { handle: "SP-9_SL-1", parallelGroup: "core", files: ["./src/a.ts"] },
    { handle: "SP-9_SL-2", parallelGroup: "core", files: ["src/a.ts"] },
  ];
  const r = validateParallelGroup(slices);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.conflicts[0].file, "src/a.ts");
});

test("three members, one shared file across two of them, names exactly that pair", () => {
  const slices: ParallelSliceInput[] = [
    { handle: "SP-9_SL-1", parallelGroup: "core", files: ["src/a.ts"] },
    {
      handle: "SP-9_SL-2",
      parallelGroup: "core",
      files: ["src/b.ts", "src/c.ts"],
    },
    { handle: "SP-9_SL-3", parallelGroup: "core", files: ["src/c.ts"] },
  ];
  const r = validateParallelGroup(slices);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].file, "src/c.ts");
  assert.deepEqual(r.conflicts[0].slices, ["SP-9_SL-2", "SP-9_SL-3"]);
});

test("empty input and empty file sets pass", () => {
  assert.equal(validateParallelGroup([]).ok, true);
  assert.equal(
    validateParallelGroup([
      { handle: "SP-9_SL-1", parallelGroup: "core", files: [] },
      { handle: "SP-9_SL-2", parallelGroup: "core" },
    ]).ok,
    true,
  );
});

test("normalizeFilePath trims and strips a single leading ./", () => {
  assert.equal(normalizeFilePath("  ./src/a.ts "), "src/a.ts");
  assert.equal(normalizeFilePath("src/a.ts"), "src/a.ts");
  assert.equal(normalizeFilePath("././src/a.ts"), "./src/a.ts");
});

// ── Ownership arbiter core ─────────────────────────────────

test("acquire then a CONFLICTING acquire is denied, naming the file and holder", () => {
  const empty: OwnershipState = {};
  const first = acquireClaim(empty, "SP-9_SL-1", ["src/a.ts", "src/shared.ts"]);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  // A second slice claiming an already-held file is denied; the prior state is
  // untouched (all-or-nothing — no partial claim is persisted).
  const second = acquireClaim(first.state, "SP-9_SL-2", [
    "src/b.ts",
    "src/shared.ts",
  ]);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.conflicts[0].file, "src/shared.ts");
  assert.equal(second.conflicts[0].heldBy, "SP-9_SL-1");
  // src/b.ts was NOT claimed — the denied acquire is atomic.
  assert.equal(first.state["src/b.ts"], undefined);
});

test("re-acquiring a file the same slice already owns is idempotent", () => {
  const s1 = acquireClaim({}, "SP-9_SL-1", ["src/a.ts"]);
  assert.equal(s1.ok, true);
  if (!s1.ok) return;
  const s2 = acquireClaim(s1.state, "SP-9_SL-1", ["src/a.ts", "src/b.ts"]);
  assert.equal(s2.ok, true);
  if (!s2.ok) return;
  assert.equal(s2.state["src/a.ts"], "SP-9_SL-1");
  assert.equal(s2.state["src/b.ts"], "SP-9_SL-1");
});

test("release frees a slice's files so another slice can claim them", () => {
  const s1 = acquireClaim({}, "SP-9_SL-1", ["src/a.ts"]);
  assert.equal(s1.ok, true);
  if (!s1.ok) return;
  const released = releaseClaim(s1.state, "SP-9_SL-1");
  assert.equal(released["src/a.ts"], undefined);
  const s2 = acquireClaim(released, "SP-9_SL-2", ["src/a.ts"]);
  assert.equal(s2.ok, true);
});

test("rehydrate-from-disk: a serialized journal round-trips to the same map", () => {
  const state: OwnershipState = {
    "src/a.ts": "SP-9_SL-1",
    "src/b.ts": "SP-9_SL-2",
  };
  const journal = serializeOwnership(state);
  assert.deepEqual(parseOwnership(journal), state);
});

test("rehydrate-from-disk fixture: a hand-written journal parses to its claims", () => {
  const journal = `{
  "version": 1,
  "claims": {
    "./src/a.ts": "SP-9_SL-1",
    "src/b.ts": "SP-9_SL-2"
  }
}`;
  assert.deepEqual(parseOwnership(journal), {
    "src/a.ts": "SP-9_SL-1", // leading ./ normalized on rehydrate
    "src/b.ts": "SP-9_SL-2",
  });
});

test("rehydrate is tolerant: garbage / wrong-shape journals degrade to no claims", () => {
  assert.deepEqual(parseOwnership("not json"), {});
  assert.deepEqual(parseOwnership("{}"), {});
  assert.deepEqual(parseOwnership('{"claims": []}'), {});
  assert.deepEqual(parseOwnership('{"claims": {"src/a.ts": 5}}'), {});
});

test("reconcile drops a dead owner's files, keeping live owners' claims", () => {
  const state: OwnershipState = {
    "src/a.ts": "SP-9_SL-1", // live
    "src/b.ts": "SP-9_SL-2", // dead — worktree gone
    "src/c.ts": "SP-9_SL-2", // dead
  };
  const r = reconcileOwnership(state, ["SP-9_SL-1"]);
  assert.deepEqual(r.state, { "src/a.ts": "SP-9_SL-1" });
  assert.deepEqual(r.dropped, [
    { file: "src/b.ts", slice: "SP-9_SL-2" },
    { file: "src/c.ts", slice: "SP-9_SL-2" },
  ]);
});

test("reconcile with all owners live drops nothing", () => {
  const state: OwnershipState = { "src/a.ts": "SP-9_SL-1" };
  const r = reconcileOwnership(state, ["SP-9_SL-1", "SP-9_SL-2"]);
  assert.deepEqual(r.state, state);
  assert.equal(r.dropped.length, 0);
});

// ── Worktree-Spec recovery ─────────────────────────────────

test("detectRecoverable: assignee-stamped open slice with no live holder is recoverable", () => {
  const slices: SliceRecoveryInfo[] = [
    { handle: "SP-9_SL-1", assignee: "spec/SP-9", status: "doing" },
  ];
  const r = detectRecoverable(slices, []); // no live holders (post-reload)
  assert.equal(r.recoverable, true);
  assert.deepEqual(r.orphaned, ["SP-9_SL-1"]);
});

test("detectRecoverable: a slice still held live is NOT orphaned", () => {
  const slices: SliceRecoveryInfo[] = [
    { handle: "SP-9_SL-1", assignee: "spec/SP-9", status: "doing" },
  ];
  const r = detectRecoverable(slices, ["SP-9_SL-1"]);
  assert.equal(r.recoverable, false);
  assert.deepEqual(r.orphaned, []);
});

test("detectRecoverable: an unstamped slice (no assignee) is never orphaned", () => {
  const slices: SliceRecoveryInfo[] = [
    { handle: "SP-9_SL-1", status: "doing" },
    { handle: "SP-9_SL-2", assignee: "  ", status: "ready" }, // blank stamp
  ];
  assert.equal(detectRecoverable(slices, []).recoverable, false);
});

test("detectRecoverable: done and archived slices are finished, not orphaned", () => {
  const slices: SliceRecoveryInfo[] = [
    { handle: "SP-9_SL-1", assignee: "spec/SP-9", status: "done" },
    { handle: "SP-9_SL-2", assignee: "spec/SP-9", status: "archived" },
  ];
  assert.equal(detectRecoverable(slices, []).recoverable, false);
});

test("detectRecoverable: returns only the orphaned handles among a mix", () => {
  const slices: SliceRecoveryInfo[] = [
    { handle: "SP-9_SL-1", assignee: "spec/SP-9", status: "done" }, // finished
    { handle: "SP-9_SL-2", assignee: "spec/SP-9", status: "doing" }, // orphaned
    { handle: "SP-9_SL-3", assignee: "spec/SP-9", status: "ready" }, // held live
    { handle: "SP-9_SL-4", status: "ready" }, // never claimed
  ];
  const r = detectRecoverable(slices, ["SP-9_SL-3"]);
  assert.equal(r.recoverable, true);
  assert.deepEqual(r.orphaned, ["SP-9_SL-2"]);
});

// ── Require a worktree before working a Spec ────────────────

test("requiresWorktree: the canonical checkout must open the worktree", () => {
  assert.equal(
    requiresWorktree("/home/u/repo", "/home/u/repo"),
    "open-worktree",
  );
  // A subdir of the canonical checkout still counts as canonical.
  assert.equal(
    requiresWorktree("/home/u/repo/src", "/home/u/repo"),
    "open-worktree",
  );
  // Trailing-slash differences don't fool it.
  assert.equal(
    requiresWorktree("/home/u/repo/", "/home/u/repo"),
    "open-worktree",
  );
});

test("requiresWorktree: a linked worktree proceeds (no false sibling-prefix match)", () => {
  assert.equal(
    requiresWorktree("/home/u/repo-worktrees/SP-5", "/home/u/repo"),
    "proceed",
  );
  // The sibling `repo-worktrees` must NOT match the `repo` prefix.
  assert.equal(
    requiresWorktree("/home/u/other/SP-5", "/home/u/repo"),
    "proceed",
  );
});

// ── validateDag (SP-tgs8nz deterministic control plane) ────────────────────

test("validateDag: a well-formed DAG passes", () => {
  const r = validateDag([
    { id: "a", requires: [] },
    { id: "b", requires: ["a"] },
    { id: "c", requires: ["a", "b"] },
  ]);
  assert.equal(r.ok, true);
});

test("validateDag: a dangling dependency is rejected, naming it", () => {
  const r = validateDag([
    { id: "a", requires: ["ghost"] },
    { id: "b", requires: ["a"] },
  ]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.missing, [{ node: "a", dep: "ghost" }]);
  assert.match(r.reason, /ghost/);
});

test("validateDag: a cycle is rejected, naming the loop", () => {
  const r = validateDag([
    { id: "a", requires: ["c"] },
    { id: "b", requires: ["a"] },
    { id: "c", requires: ["b"] },
  ]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.cycle && r.cycle.length >= 2, "names the cycle path");
  assert.match(r.reason, /cycle/i);
});

test("validateDag: a self-loop is a cycle", () => {
  const r = validateDag([{ id: "a", requires: ["a"] }]);
  assert.equal(r.ok, false);
});

test("validateDag: dangling deps are reported before cycles", () => {
  const r = validateDag([
    { id: "a", requires: ["b", "ghost"] },
    { id: "b", requires: ["a"] }, // also a cycle, but the dangling dep wins
  ]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.missing, "reports the missing dep first");
});

// ── footprintGuard (SP-tgs8nz_SL-6 PreToolUse fence) ───────────────────────

test("footprintGuard: an in-footprint Write is allowed", () => {
  const d = footprintGuard(
    "Write",
    { file_path: "src/a.ts" },
    ["src/a.ts", "src/b.ts"],
    "/wt",
  );
  assert.equal(d.allow, true);
});

test("footprintGuard: an out-of-footprint Edit is DENIED, naming the file", () => {
  const d = footprintGuard(
    "Edit",
    { file_path: "src/evil.ts" },
    ["src/a.ts"],
    "/wt",
  );
  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.match(d.reason, /src\/evil\.ts/);
  assert.match(d.reason, /footprint/);
});

test("footprintGuard: an absolute path under the worktree is relativized before comparison", () => {
  const d = footprintGuard(
    "Write",
    { file_path: "/wt/src/a.ts" },
    ["src/a.ts"],
    "/wt",
  );
  assert.equal(d.allow, true);
});

test("footprintGuard: non-write tools (Read, Bash) are not guarded", () => {
  assert.equal(
    footprintGuard("Read", { file_path: "src/x.ts" }, [], "/wt").allow,
    true,
  );
  assert.equal(
    footprintGuard("Bash", { command: "ls" }, [], "/wt").allow,
    true,
  );
});

test("footprintGuard: a write with no file_path is allowed (nothing to fence)", () => {
  assert.equal(footprintGuard("Write", {}, ["src/a.ts"], "/wt").allow, true);
  assert.equal(
    footprintGuard("Edit", undefined, ["src/a.ts"], "/wt").allow,
    true,
  );
});

test("footprintGuard: ./-prefixed footprint matches the bare target", () => {
  const d = footprintGuard(
    "Edit",
    { file_path: "src/a.ts" },
    ["./src/a.ts"],
    "/wt",
  );
  assert.equal(d.allow, true);
});

test("footprintGuard: MultiEdit is guarded like Edit/Write", () => {
  assert.equal(
    footprintGuard("MultiEdit", { file_path: "out.ts" }, ["in.ts"], "/wt")
      .allow,
    false,
  );
});

// ── footprintContainment (SP-6/2 AC3: Bash-inclusive post-tool containment) ──
//
// The PreToolUse `footprintGuard` only fences tools that expose a `file_path`
// (Edit/Write/MultiEdit). `footprintContainment` is the post-tool authority: it
// reads the working-tree diff (`git status --porcelain` text) and flags any
// create/modify/delete OUTSIDE the unit's declared footprint, no matter which
// tool produced it — closing the hole a Bash `rm`/`cat >`/`mv`/`sed -i`/redirect
// drives through the pre-tool guard (the stub-and-`rm` deletion). Pure: porcelain
// + footprint in, the out-of-footprint changes out.

/** Narrow a ContainmentResult to its failing branch for assertions. */
function expectViolation(r: ContainmentResult) {
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("expected a containment violation");
  return r;
}

test("footprintContainment: an in-footprint modify passes", () => {
  // The unit edited only its own footprint file — its own work, allowed.
  const porcelain = " M src/methodology/parallelSlices.test.ts\n";
  const r = footprintContainment(porcelain, [
    "src/methodology/parallelSlices.test.ts",
  ]);
  assert.equal(r.ok, true);
});

test("footprintContainment: an empty (clean) working tree passes", () => {
  assert.equal(footprintContainment("", ["src/a.ts"]).ok, true);
  // Blank/whitespace-only lines are ignored, not treated as a change.
  assert.equal(footprintContainment("\n   \n", ["src/a.ts"]).ok, true);
});

test("footprintContainment: an out-of-footprint Bash create (cat >/redirect) is detected", () => {
  // A worker ran `cat > src/evil.ts` — an untracked file the pre-tool guard
  // never saw (Bash carries no file_path). Porcelain marks it `??`.
  const r = expectViolation(
    footprintContainment("?? src/evil.ts\n", ["src/a.ts"]),
  );
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].file, "src/evil.ts");
  assert.equal(r.violations[0].change, "create");
  // The reason names the offending path and says this is terminal, not a deny.
  assert.match(r.reason, /src\/evil\.ts/);
  assert.match(r.reason, /requires-attention/);
  assert.match(r.reason, /terminal/i);
});

test("footprintContainment: an out-of-footprint Bash delete (rm) is detected — the stub-and-rm hole", () => {
  // The exploit SP-6/2 closes: a worker `rm`s a SIBLING unit's produced file.
  // Its footprint is only the test file, so deleting the source is out-of-bounds.
  const r = expectViolation(
    footprintContainment(" D src/methodology/parallelSlices.ts\n", [
      "src/methodology/parallelSlices.test.ts",
    ]),
  );
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].file, "src/methodology/parallelSlices.ts");
  assert.equal(r.violations[0].change, "delete");
  assert.match(r.reason, /parallelSlices\.ts/);
});

test("footprintContainment: an out-of-footprint modify (sed -i) is detected", () => {
  const r = expectViolation(
    footprintContainment(" M src/other.ts\n", ["src/a.ts"]),
  );
  assert.equal(r.violations[0].file, "src/other.ts");
  assert.equal(r.violations[0].change, "modify");
});

test("footprintContainment: deleting a file IN the footprint is allowed (fences only outside)", () => {
  // Containment fences changes OUTSIDE the footprint, never within it — a unit
  // may delete/replace files it owns.
  const r = footprintContainment(" D src/a.ts\n", ["src/a.ts"]);
  assert.equal(r.ok, true);
});

test("footprintContainment: a mix of in- and out-of-footprint changes reports only the out-of-footprint ones", () => {
  const porcelain = [
    " M src/a.ts", // owned — fine
    "?? src/evil.ts", // out — violation
    " D src/gone.ts", // out — violation
    "M  src/b.ts", // owned (staged) — fine
  ].join("\n");
  const r = expectViolation(
    footprintContainment(porcelain, ["src/a.ts", "src/b.ts"]),
  );
  // Sorted by path; only the two out-of-footprint paths surface.
  assert.deepEqual(
    r.violations.map((v) => v.file),
    ["src/evil.ts", "src/gone.ts"],
  );
});

test("footprintContainment: a rename OUT of the footprint surfaces the destination", () => {
  // `git mv src/a.ts src/moved.ts` — the footprint file's new home is out of bounds.
  const r = expectViolation(
    footprintContainment("R  src/a.ts -> src/moved.ts\n", ["src/a.ts"]),
  );
  // The orig endpoint is owned; the destination is the out-of-footprint change.
  assert.ok(
    r.violations.some((v) => v.file === "src/moved.ts"),
    "names the rename destination",
  );
  assert.ok(
    !r.violations.some((v) => v.file === "src/a.ts"),
    "the owned origin endpoint is not a violation",
  );
});

test("footprintContainment: path normalization — a ./-prefixed footprint matches the bare porcelain path", () => {
  // Footprint declared with ./, porcelain emits bare — they must compare equal.
  assert.equal(footprintContainment(" M src/a.ts\n", ["./src/a.ts"]).ok, true);
});

test("footprintContainment: a quoted/escaped porcelain path is decoded before comparison", () => {
  // git quotes paths with special chars; the owned file must still match.
  assert.equal(
    footprintContainment(' M "src/a\\tb.ts"\n', ["src/a\tb.ts"]).ok,
    true,
  );
  // And an out-of-footprint quoted path is still caught, decoded.
  const r = expectViolation(
    footprintContainment('?? "src/e\\tvil.ts"\n', ["src/a.ts"]),
  );
  assert.equal(r.violations[0].file, "src/e\tvil.ts");
});

test("footprintContainment: an empty footprint flags every change", () => {
  const r = expectViolation(footprintContainment("?? src/x.ts\n", []));
  assert.equal(r.violations[0].file, "src/x.ts");
  assert.match(r.reason, /\(none\)/);
});

test("footprintContainment: the same out-of-footprint path on multiple lines is reported once", () => {
  const r = expectViolation(
    footprintContainment("?? src/evil.ts\n?? src/evil.ts\n", ["src/a.ts"]),
  );
  assert.equal(r.violations.length, 1);
});

// ── footprintContainment cross-unit attribution (SP-2 / TEP-6 AC4) ──────────
//
// The porcelain the check is fed is a WHOLE-TREE diff of the shared worktree, so
// it also shows every OTHER running unit's (and earlier units') legitimate,
// in-their-own-footprint changes. Without context the check misattributes those to
// THIS unit and reverts them (the mutual-destruction failure: two disjoint-footprint
// units each flagged and reverted the other's file). The optional 3rd arg fences a
// change to a violation ONLY when it is outside this unit's footprint AND outside
// `running` (every running unit's footprint) AND not in `baseline` (paths already
// dirty when this unit started). With the arg absent, behaviour is unchanged (AC3).

test("footprintContainment: a change in a concurrent sibling's footprint (running) is NOT a violation", () => {
  // The classic mutual-destruction case: this unit owns orchestratorCore.ts; a
  // concurrent sibling owns (and is editing) parallelSlices.ts. The whole-tree diff
  // shows both, but the sibling's in-footprint change must not be flagged here.
  const porcelain = [
    " M src/methodology/orchestratorCore.ts", // owned — fine
    " M src/methodology/parallelSlices.ts", // a concurrent sibling's footprint
  ].join("\n");
  const r = footprintContainment(
    porcelain,
    ["src/methodology/orchestratorCore.ts"],
    { running: ["src/methodology/parallelSlices.ts"] },
  );
  assert.equal(r.ok, true);
});

test("footprintContainment: a change already present at unit start (baseline) is NOT a violation", () => {
  // An earlier unit left src/earlier.ts dirty before this unit ran; it predates this
  // unit's run, so containment must not attribute (and revert) it here.
  const r = footprintContainment(" M src/earlier.ts\n", ["src/a.ts"], {
    baseline: ["src/earlier.ts"],
  });
  assert.equal(r.ok, true);
});

test("footprintContainment: a path outside footprint AND running AND baseline STILL violates (create)", () => {
  // A genuine breach: src/evil.ts is in no unit's footprint and wasn't present at
  // start — this unit truly left it out of bounds, so it must STILL be flagged.
  const r = expectViolation(
    footprintContainment("?? src/evil.ts\n", ["src/a.ts"], {
      running: ["src/sibling.ts"],
      baseline: ["src/preexisting.ts"],
    }),
  );
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].file, "src/evil.ts");
  assert.equal(r.violations[0].change, "create");
});

test("footprintContainment: with running+baseline, sibling/baseline changes are exempt but a true breach (delete) still flags", () => {
  // A whole-tree diff carrying: this unit's own work, a concurrent sibling's
  // in-footprint edit, a baseline (pre-existing) change, and ONE genuine breach.
  // Only the genuine breach survives the running/baseline exemptions.
  const porcelain = [
    " M src/a.ts", // owned — fine
    " M src/sibling.ts", // concurrent sibling's footprint — exempt
    " M src/earlier.ts", // already dirty at start (baseline) — exempt
    " D src/gone.ts", // TRUE breach: out of footprint/running/baseline
  ].join("\n");
  const r = expectViolation(
    footprintContainment(porcelain, ["src/a.ts"], {
      running: ["src/sibling.ts"],
      baseline: ["src/earlier.ts"],
    }),
  );
  assert.deepEqual(
    r.violations.map((v) => v.file),
    ["src/gone.ts"],
  );
  assert.equal(r.violations[0].change, "delete");
});

test("footprintContainment: a rename whose destination is a sibling's footprint (running) is exempt; one to a true out-of-bounds path flags", () => {
  // Rename endpoints obey the same exemptions. A move INTO a running sibling's
  // footprint is that sibling's territory (exempt); a move to a path owned by no one
  // and not in baseline is a genuine out-of-footprint destination (flagged).
  const exempt = footprintContainment(
    "R  src/a.ts -> src/sibling.ts\n",
    ["src/a.ts"],
    { running: ["src/sibling.ts"] },
  );
  assert.equal(
    exempt.ok,
    true,
    "rename dest inside a running footprint is exempt",
  );

  const r = expectViolation(
    footprintContainment("R  src/a.ts -> src/moved.ts\n", ["src/a.ts"], {
      running: ["src/sibling.ts"],
      baseline: [],
    }),
  );
  assert.ok(r.violations.some((v) => v.file === "src/moved.ts"));
});

test("footprintContainment: with the context absent, behaviour is exactly as before (AC3 unchanged)", () => {
  // Backward-compat guard: no 3rd arg ⇒ any path outside the footprint is flagged,
  // exactly as the AC3 tests above expect.
  const r = expectViolation(
    footprintContainment("?? src/evil.ts\n", ["src/a.ts"]),
  );
  assert.equal(r.violations[0].file, "src/evil.ts");
  // Empty context objects are equivalent to absent (no exemptions).
  assert.equal(
    footprintContainment("?? src/evil.ts\n", ["src/a.ts"], {}).ok,
    false,
  );
  assert.equal(
    footprintContainment("?? src/evil.ts\n", ["src/a.ts"], {
      running: [],
      baseline: [],
    }).ok,
    false,
  );
});

// ── undeclaredReadsCheck (SP-6/2 AC2: the declared cross-unit read gate) ──────
//
// `consumes` builds a real dependency edge the scheduler orders on; `reads`
// merely declares a file a unit reads. The hole this closes: a unit `reads:` a
// file ANOTHER unit in the same Spec produces but declares no `consumes` for it —
// an undeclared cross-unit dependency. With no edge the scheduler may dispatch the
// reader before the producer has landed (the prose-note dependency that caused the
// SL-1/SL-2 deletion). The gate is pure and declared: a read that lands on a
// SIBLING's footprint with no matching `consumes` is refused, naming the producer;
// a declared+consumed read passes; a read of a file no sibling produces (a
// pre-existing file) passes.

/** Narrow an UndeclaredReadResult to its failing branch for assertions. */
function expectUndeclaredRead(r: UndeclaredReadResult) {
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("expected an undeclared-read violation");
  return r;
}

test("undeclaredReadsCheck: an undeclared cross-unit read is refused, naming the producing unit", () => {
  // The test unit reads a file a SIBLING produces but declares no `consumes` for
  // it — an undeclared cross-unit dependency the scheduler can't order on.
  const units: ContractFirstWorkUnit[] = [
    {
      footprint: ["src/methodology/parallelSlices.ts"],
      execution: "serial",
      note: "produce the parallelSlices helpers",
    },
    {
      footprint: ["src/methodology/parallelSlices.test.ts"],
      reads: ["src/methodology/parallelSlices.ts"], // read, but not consumed
      execution: "fan-out",
      note: "AC2 tests",
    },
  ];
  const r = expectUndeclaredRead(undeclaredReadsCheck(units));
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].file, "src/methodology/parallelSlices.ts");
  // The violation and message name the offending file AND the producing unit.
  assert.match(r.violations[0].producer, /produce the parallelSlices helpers/);
  assert.match(r.message, /src\/methodology\/parallelSlices\.ts/);
  assert.match(r.message, /produce the parallelSlices helpers/);
  // The teaching message is the shared, exported constant — not a hardcoded copy.
  assert.ok(r.message.startsWith(UNDECLARED_READ_RULE_MSG));
});

test("undeclaredReadsCheck: a declared + consumed read passes", () => {
  // Same read, but now the unit also `consumes:` it — a real edge the scheduler
  // orders on, so the dependency is declared and the gate is satisfied.
  const units: ContractFirstWorkUnit[] = [
    {
      footprint: ["src/methodology/parallelSlices.ts"],
      execution: "serial",
      note: "produce the parallelSlices helpers",
    },
    {
      footprint: ["src/methodology/parallelSlices.test.ts"],
      reads: ["src/methodology/parallelSlices.ts"],
      consumes: ["src/methodology/parallelSlices.ts"], // declared dependency edge
      execution: "fan-out",
      note: "AC2 tests",
    },
  ];
  assert.equal(undeclaredReadsCheck(units).ok, true);
});

test("undeclaredReadsCheck: a read of a non-sibling (pre-existing) file passes", () => {
  // The unit reads a file NO sibling produces — a pre-existing file in the repo.
  // The gate fences cross-unit reads, not reads of the world, so this is fine.
  const units: ContractFirstWorkUnit[] = [
    {
      footprint: ["src/methodology/parallelSlices.ts"],
      execution: "serial",
      note: "produce the parallelSlices helpers",
    },
    {
      footprint: ["src/methodology/parallelSlices.test.ts"],
      reads: ["src/services/orchestratorCore.ts"], // produced by no unit here
      execution: "fan-out",
      note: "AC2 tests",
    },
  ];
  assert.equal(undeclaredReadsCheck(units).ok, true);
});

test("undeclaredReadsCheck: reading a file the unit ITSELF produces is its own work, not a cross-unit read", () => {
  // A read of a file in the unit's own footprint is its own production — never a
  // cross-unit dependency, so no `consumes` is required.
  const units: ContractFirstWorkUnit[] = [
    {
      footprint: ["src/methodology/parallelSlices.ts"],
      reads: ["src/methodology/parallelSlices.ts"], // its own footprint
      execution: "serial",
    },
  ];
  assert.equal(undeclaredReadsCheck(units).ok, true);
});

test("undeclaredReadsCheck: no reads / empty input passes", () => {
  assert.equal(undeclaredReadsCheck([]).ok, true);
  assert.equal(
    undeclaredReadsCheck([
      { footprint: ["src/a.ts"], execution: "serial" },
      { footprint: ["src/b.ts"], execution: "fan-out" },
    ]).ok,
    true,
  );
});

test("undeclaredReadsCheck: path normalization — a ./-prefixed read matches a sibling's bare footprint", () => {
  const units: ContractFirstWorkUnit[] = [
    { footprint: ["src/shared.ts"], execution: "serial", note: "producer" },
    {
      footprint: ["src/reader.ts"],
      reads: ["./src/shared.ts"], // ./-prefixed read of the bare-declared production
      execution: "fan-out",
      note: "reader",
    },
  ];
  const r = expectUndeclaredRead(undeclaredReadsCheck(units));
  assert.equal(r.violations[0].file, "src/shared.ts");
  assert.match(r.violations[0].producer, /producer/);
});

// ── Acceptance-evidence path convention (SP-6/6 AC2) ─────────────────────────
//
// Mechanism 5 holds the exam out of the implementer's reach: the acceptance probes
// the closing gate runs are authored by the held-out verifier and committed to a
// reserved location — by convention, any path with an `acceptance/` directory
// segment. The footprint resolver treats such a path as NEVER-in-footprint: no unit
// can own it (`resolveFootprint` strips it), the PreToolUse guard (`footprintGuard`)
// denies a write to it even when the unit declared it, and the post-tool containment
// check (`footprintContainment`) flags ANY change that lands there as a violation —
// no owned/running/baseline exemption can excuse it. The deterministic analog of
// "the student cannot write the answer key." Pure: a path-shape convention, no I/O.

test("isAcceptanceEvidencePath: an `acceptance/` directory segment marks held-out evidence", () => {
  // A leading, nested, or dot-prefixed `acceptance` segment all match.
  assert.equal(isAcceptanceEvidencePath("acceptance/SP-6.test.ts"), true);
  assert.equal(isAcceptanceEvidencePath("tests/acceptance/foo.test.ts"), true);
  assert.equal(
    isAcceptanceEvidencePath(".tandem/acceptance/SP-6.test.ts"),
    true,
  );
  // Trailing-segment form (a bare `acceptance` dir) matches too.
  assert.equal(isAcceptanceEvidencePath("tests/acceptance"), true);
  // Normalization: a ./-prefixed evidence path still matches.
  assert.equal(isAcceptanceEvidencePath("./acceptance/x.test.ts"), true);
});

test("isAcceptanceEvidencePath: a substring that is NOT a path segment does not match", () => {
  // `acceptanceFoo.ts` / `acceptance.ts` are ordinary files — the marker is a
  // directory segment, anchored to path boundaries, not any substring.
  assert.equal(isAcceptanceEvidencePath("src/acceptanceFoo.ts"), false);
  assert.equal(isAcceptanceEvidencePath("src/acceptance.ts"), false);
  assert.equal(isAcceptanceEvidencePath("src/a.ts"), false);
  // Empty / blank paths are not evidence.
  assert.equal(isAcceptanceEvidencePath(""), false);
  assert.equal(isAcceptanceEvidencePath("   "), false);
});

test("isAcceptanceEvidencePath: the exported regex is the shared convention (no drift)", () => {
  // The convention is named via the exported constant so callers don't re-derive it.
  assert.equal(ACCEPTANCE_EVIDENCE_RE.test("tests/acceptance/x.ts"), true);
  assert.equal(ACCEPTANCE_EVIDENCE_RE.test("src/acceptanceFoo.ts"), false);
});

test("isAcceptanceEvidencePath: an override predicate replaces the default convention", () => {
  // A caller can supply its own evidence-path shape (e.g. a `__grader__/` dir).
  const opts = {
    isAcceptanceEvidence: (f: string) => f.includes("__grader__/"),
  };
  assert.equal(isAcceptanceEvidencePath("x/__grader__/g.ts", opts), true);
  // The default `acceptance/` no longer counts under the override.
  assert.equal(isAcceptanceEvidencePath("tests/acceptance/x.ts", opts), false);
});

test("resolveFootprint: an acceptance-evidence path is stripped so it is never-in-footprint", () => {
  // Even if a unit lists the held-out evidence in its footprint, the resolver drops
  // it — the path is left unowned so the guard/containment checks fence it.
  const resolved = resolveFootprint([
    "src/a.ts",
    "tests/acceptance/SP-6.test.ts",
    "src/b.ts",
  ]);
  assert.deepEqual(resolved, ["src/a.ts", "src/b.ts"]);
});

test("resolveFootprint: a footprint with no evidence paths is returned unchanged", () => {
  const fp = ["src/a.ts", "src/b.ts"];
  assert.deepEqual(resolveFootprint(fp), fp);
  // Empty / undefined footprints are handled.
  assert.deepEqual(resolveFootprint([]), []);
});

test("footprintGuard: a CODE-author cannot write the held-out probe (acceptance stripped from its role footprint)", () => {
  // resolveRoleFootprint("code", …) strips acceptance, so a code unit never owns the probe:
  // footprintGuard denies its write. The reason is TERSE/generic (out-of-footprint) — it must NOT
  // name "grading evidence"/"independent verifier", so the worker isn't taught the fence to game it.
  const owned = resolveRoleFootprint("code", [
    "tests/acceptance/SP-6.test.ts",
    "src/a.ts",
  ]);
  const d = footprintGuard(
    "Write",
    { file_path: "tests/acceptance/SP-6.test.ts" },
    owned,
    "/wt",
  );
  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.match(d.reason, /tests\/acceptance\/SP-6\.test\.ts/);
  assert.match(d.reason, /out-of-footprint/i);
  assert.doesNotMatch(d.reason, /grading evidence|independent verifier|held-out/i);
});

test("codeReadFence (SP-6/7 reverse-leak): a code worker cannot Read an acceptance probe; everything else passes", () => {
  const wt = "/home/u/repos/ext-worktrees/SP-6_3"; // the cwd (repoRoot)
  // A Read of a held-out probe (relative or absolute under the worktree) → denied, tersely —
  // the reason must not teach the grading mechanism.
  const rel = codeReadFence("Read", { file_path: "src/acceptance/SP-6_3_AC-1.test.ts" }, wt);
  assert.equal(rel.allow, false);
  if (rel.allow) return;
  assert.match(rel.reason, /out-of-scope read/i);
  assert.doesNotMatch(rel.reason, /grading|held-out|independent|probe|evidence/i);
  assert.equal(
    codeReadFence("Read", { file_path: `${wt}/src/acceptance/SP-6_3_AC-2.test.ts` }, wt).allow,
    false,
  );
  // Ordinary source, tests, config → readable.
  assert.equal(codeReadFence("Read", { file_path: "src/services/approvalToken.ts" }, wt).allow, true);
  assert.equal(codeReadFence("Read", { file_path: `${wt}/tsconfig.test.json` }, wt).allow, true);
  // Only Read is screened here — writes are the write-fence's job.
  assert.equal(codeReadFence("Write", { file_path: "src/acceptance/x.test.ts" }, wt).allow, true);
  assert.equal(codeReadFence("Glob", { pattern: "src/**/*" }, wt).allow, true);
});

test("footprintGuard: NotebookEdit is a guarded write tool (notebook_path screened like file_path)", () => {
  // In-footprint notebook edit → allowed; out-of-footprint → denied.
  assert.equal(
    footprintGuard("NotebookEdit", { notebook_path: "nb/owned.ipynb" }, ["nb/owned.ipynb"], "/wt")
      .allow,
    true,
  );
  const d = footprintGuard(
    "NotebookEdit",
    { notebook_path: "nb/other.ipynb" },
    ["nb/owned.ipynb"],
    "/wt",
  );
  assert.equal(d.allow, false);
});

test("footprintGuard: the HELD-OUT test-author MAY write its own probe (its role footprint IS the probe)", () => {
  // SP-6/7: resolveRoleFootprint("test", …) keeps only the acceptance paths — the test-author owns
  // its probe, so the guard allows the very write a code-author is denied.
  const owned = resolveRoleFootprint("test", ["tests/acceptance/SP-6.test.ts"]);
  assert.equal(
    footprintGuard(
      "Write",
      { file_path: "tests/acceptance/SP-6.test.ts" },
      owned,
      "/wt",
    ).allow,
    true,
  );
  // Absolute path under the worktree, same result.
  assert.equal(
    footprintGuard(
      "Edit",
      { file_path: "/wt/tests/acceptance/SP-6.test.ts" },
      owned,
      "/wt",
    ).allow,
    true,
  );
});

test("footprintContainment: a CODE-author's CREATE of an acceptance file is a violation (authored its grader)", () => {
  // A code unit (owned = src/a.ts) that leaves a probe in the tree wrote the held-out evidence it is
  // judged on — a containment violation that aborts to requires-attention, never a self-authored green.
  const r = expectViolation(
    footprintContainment("?? tests/acceptance/SP-6.test.ts\n", ["src/a.ts"]),
  );
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].file, "tests/acceptance/SP-6.test.ts");
  assert.equal(r.violations[0].change, "create");
  assert.match(r.reason, /tests\/acceptance\/SP-6\.test\.ts/);
});

test("footprintContainment: the test-author's OWN probe (in its footprint) is NOT a violation", () => {
  // SP-6/7: the held-out verifier OWNS its acceptance probe — authoring it is legitimate, not a breach.
  const r = footprintContainment(" M tests/acceptance/SP-6.test.ts\n", [
    "tests/acceptance/SP-6.test.ts",
  ]);
  assert.equal(r.ok, true);
});

test("footprintContainment: a SIBLING test-author's acceptance probe (in the union) is exempt — concurrent held-out authors don't revert each other", () => {
  // SP-6/7: the four held-out test-authors run concurrently in the shared worktree, each writing its
  // OWN probe. So from unit X's post-tool diff, a SIBLING's probe (in the run-level `running` union)
  // must be exempt — else every test-author reverts its siblings' probes (only one survives). An
  // acceptance path is treated like any other: exempt via owned OR running OR baseline.
  const r = footprintContainment(
    " M tests/acceptance/SP-6_AC-3.test.ts\n" + " M tests/acceptance/SP-6_AC-4.test.ts\n",
    ["tests/acceptance/SP-6_AC-2.test.ts"], // this unit owns AC-2
    { running: ["tests/acceptance/SP-6_AC-3.test.ts", "tests/acceptance/SP-6_AC-4.test.ts"] },
  );
  assert.equal(r.ok, true, "siblings' probes (in the union) are not reverted");
});

test("footprintContainment: a non-evidence change beside an evidence change reports both correctly", () => {
  // An in-footprint edit (fine), a sibling's edit (exempt), and an evidence write
  // (always a violation) — only the evidence write surfaces.
  const porcelain = [
    " M src/a.ts", // owned — fine
    " M src/sibling.ts", // running sibling — exempt
    "?? tests/acceptance/SP-6.test.ts", // evidence — violation
  ].join("\n");
  const r = expectViolation(
    footprintContainment(porcelain, ["src/a.ts"], {
      running: ["src/sibling.ts"],
    }),
  );
  assert.deepEqual(
    r.violations.map((v) => v.file),
    ["tests/acceptance/SP-6.test.ts"],
  );
});

test("footprintContainment: an override predicate flows through — custom evidence is owner-only exempt", () => {
  // The opts override redefines the evidence shape (`__grader__/`). Under SP-6/7, evidence is exempt
  // ONLY for the unit that OWNS it: a NON-owner (owned = src/a.ts) touching `__grader__/` violates,
  // while its OWNER (declared it) may author it. Meanwhile the default `acceptance/` is, under this
  // override, an ordinary owned file.
  const opts = {
    isAcceptanceEvidence: (f: string) => f.includes("__grader__/"),
  };
  const r = expectViolation(
    footprintContainment(" M x/__grader__/g.ts\n", ["src/a.ts"], undefined, opts),
  );
  assert.equal(r.violations[0].file, "x/__grader__/g.ts");
  // The OWNER of the grader (declared it in footprint) may author it — no violation.
  assert.equal(
    footprintContainment(
      " M x/__grader__/g.ts\n",
      ["x/__grader__/g.ts"],
      undefined,
      opts,
    ).ok,
    true,
  );
  // Under the override, `acceptance/` is just a normal owned file → no violation.
  assert.equal(
    footprintContainment(
      " M tests/acceptance/x.ts\n",
      ["tests/acceptance/x.ts"],
      undefined,
      opts,
    ).ok,
    true,
  );
});

// ── SP-6/7 AC1: the role-vs-held-out footprint split ───────────────────────
// resolveRoleFootprint is the inverse pair of resolveFootprint: a `code` unit can NEVER own the
// held-out acceptance evidence (it is stripped), while a `test` unit's footprint IS exactly the
// held-out `acceptance/` probe — the independent evidence the closing gate grades on.

test("resolveRoleFootprint: a test unit's footprint is ONLY its held-out acceptance/ paths", () => {
  const declared = [
    "acceptance/SP-6.foo.test.ts",
    "src/foo.ts",
    "tests/acceptance/bar.test.ts",
  ];
  assert.deepEqual(resolveRoleFootprint("test", declared), [
    "acceptance/SP-6.foo.test.ts",
    "tests/acceptance/bar.test.ts",
  ]);
});

test("resolveRoleFootprint: a code unit can never own the held-out acceptance evidence (stripped)", () => {
  const declared = ["src/foo.ts", "acceptance/SP-6.foo.test.ts"];
  // code role mirrors resolveFootprint — acceptance/ paths removed.
  assert.deepEqual(resolveRoleFootprint("code", declared), ["src/foo.ts"]);
  assert.deepEqual(resolveRoleFootprint("code", declared), resolveFootprint(declared));
  // an absent role defaults to code.
  assert.deepEqual(resolveRoleFootprint(undefined, declared), ["src/foo.ts"]);
});

test("resolveRoleFootprint: honours a custom acceptance-evidence predicate for both roles", () => {
  const opts = { isAcceptanceEvidence: (f: string) => f.startsWith("held/") };
  const declared = ["held/probe.test.ts", "src/x.ts"];
  assert.deepEqual(resolveRoleFootprint("test", declared, opts), ["held/probe.test.ts"]);
  assert.deepEqual(resolveRoleFootprint("code", declared, opts), ["src/x.ts"]);
});

// ── codeTestFence (tests-first belt, 2026-07-08): a code worker never touches tests ──

test("codeTestFence: a write to any *.test.* or acceptance/ path is denied regardless of footprint", () => {
  for (const fp of [
    "src/services/workerModel.test.ts",
    "src/acceptance/SP-17_1_AC-1.test.ts",
    "acceptance/probe.test.ts",
  ]) {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      const d = codeTestFence(tool, { file_path: fp }, false);
      assert.equal(d.allow, false, `${tool} → ${fp} must be denied`);
    }
  }
  // an ordinary source write passes through untouched
  assert.deepEqual(
    codeTestFence("Write", { file_path: "src/services/workerModel.ts" }, true),
    { allow: true },
  );
});

test("codeTestFence: with the oracle armed, Bash that reaches tests or the toolchain is denied", () => {
  const denied = [
    "cat ../thinkube-ai-integration-worktrees/TEP-17_SP-1-test/src/acceptance/SP-17_1_AC-1.test.ts",
    "grep -rn model src/acceptance/",
    "npm install",
    "npx tsc -p tsconfig.test.json",
    "node --test out-test/",
    "sed -n 1,20p src/x.test.ts",
  ];
  for (const command of denied) {
    const d = codeTestFence("Bash", { command }, true);
    assert.equal(d.allow, false, `oracle-armed Bash must deny: ${command}`);
  }
  const allowed = ["ls src/services", "git status --porcelain", "node -e \"console.log(1)\""];
  for (const command of allowed) {
    assert.deepEqual(codeTestFence("Bash", { command }, true), { allow: true }, `must allow: ${command}`);
  }
});

test("codeTestFence: without the oracle, Bash is untouched (selfVerify still legitimate) but test writes stay denied", () => {
  assert.deepEqual(codeTestFence("Bash", { command: "npm test" }, false), { allow: true });
  assert.equal(codeTestFence("Write", { file_path: "a/b.test.ts" }, false).allow, false);
});
