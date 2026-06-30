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

test("overlapping work-unit footprints in a parallel_group are refused (SP-tgs8gb)", () => {
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

// ── Ownership arbiter core (SP-tgpwbm AC3) ─────────────────────────────────

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

// ── Worktree-Spec recovery (SP-tgpwbm AC5) ─────────────────────────────────

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

// ── Require a worktree before working a Spec (SP-tgpwbm AC2) ────────────────

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
