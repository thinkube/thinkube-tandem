/**
 * INVARIANT: unwiredEngineModules returns its paths sorted and
 * repo-relative, so two runs over the same file map give the same list in
 * the same order. A ledger diff (ENGINE-WIRING.md against a fresh run)
 * must never show spurious reordering churn — this must hold forever.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unwiredEngineModules } from "./engineWiring";

test("unwiredEngineModules is deterministic and sorted across repeat runs on the same file map", () => {
  const files = [
    {
      path: "src/entry.ts",
      content: `export function run(): void {}\n`,
    },
    {
      path: "src/engine/zebra.ts",
      content: `export function zebra(): void {}\n`,
    },
    {
      path: "src/engine/alpha.ts",
      content: `export function alpha(): void {}\n`,
    },
    {
      path: "src/engine/middle.ts",
      content: `export function middle(): void {}\n`,
    },
  ];
  const first = unwiredEngineModules(files, ["src/entry.ts"]);
  const second = unwiredEngineModules(files, ["src/entry.ts"]);
  assert.deepEqual(first, second, "two runs over the same file map give the same list");
  const sorted = [...first].sort();
  assert.deepEqual(first, sorted, "the returned list is sorted");
  for (const p of first) {
    assert.equal(p.startsWith("src/"), true, `expected a repo-relative path, got ${p}`);
  }
});
