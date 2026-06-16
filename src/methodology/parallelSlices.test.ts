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
  type ParallelSliceInput,
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
