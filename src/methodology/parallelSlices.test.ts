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
  acquireClaim,
  releaseClaim,
  reconcileOwnership,
  serializeOwnership,
  parseOwnership,
  type ParallelSliceInput,
  type OwnershipState,
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
