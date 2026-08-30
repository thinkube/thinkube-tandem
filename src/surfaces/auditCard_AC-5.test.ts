/**
 * TRANSITION — proves the audit card's green chip stopped being computed
 * from a `role === "code"` filter and now comes only from an empty
 * unpassedWorkers(...) result, so the card can never go green while a
 * tester or maintainer is still unpassed. webview/map is not part of the
 * test build (only the host tree compiles under the test suite), so the
 * card's own rendering cannot be driven directly; this test drives the
 * real unpassedWorkers export this cut builds to pin the verdict it must
 * produce, then reads Run.tsx's source text to confirm the card is wired
 * to that same function rather than to a reimplemented, coder-only filter.
 * Its work is done once the rewrite lands; after that this file just
 * guards the rewrite from silently regressing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { unpassedWorkers } from "./auditCard";

interface RunUnitLike {
  id: string;
  slice: string;
  role: "code" | "test" | "maintain";
  state: string;
}

function runTsxSource(): string {
  return fs.readFileSync(path.join(__dirname, "..", "..", "webview", "map", "src", "Run.tsx"), "utf8");
}

test("a slice with every coder done but its tester still running is not unpassed-empty", () => {
  const units: RunUnitLike[] = [
    { id: "SL-1#eu-1", slice: "SL-1", role: "code", state: "done" },
    { id: "SL-1#eu-2", slice: "SL-1", role: "code", state: "done" },
    { id: "SL-1#eu-3", slice: "SL-1", role: "test", state: "running" },
  ];

  const unpassed = unpassedWorkers(units, "SL-1");

  assert.notDeepEqual(
    unpassed,
    [],
    "the card's green chip source must not be empty while the tester is still running, " +
      "even though a role === \"code\" filter alone would call every coder done",
  );
});

test("the audit card imports and uses unpassedWorkers for its verdict", () => {
  const src = runTsxSource();

  assert.match(
    src,
    /unpassedWorkers/,
    "Run.tsx must import and call unpassedWorkers to compute the audit card's verdict",
  );
});

test("no role === \"code\" filter is left deciding the audit card's verdict", () => {
  const src = runTsxSource();

  assert.doesNotMatch(
    src,
    /role\s*===\s*["']code["']\)\.every\(/,
    "the audit card's green chip must not be derived from a code-only .every(...) filter",
  );
});
