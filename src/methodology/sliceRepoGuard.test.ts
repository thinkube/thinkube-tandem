/**
 * Preliminary-control gate tests (SP-th1ddy_SL-2 AC). The guard
 * `sliceFilesResolveInRepo` decides whether a slice's `files:` are repo-relative
 * *inside the board's own repo*. This proves the gate refuses the three bad
 * shapes — absolute paths, `..`-escaping paths, different-repo paths — and
 * accepts a repo-relative footprint, naming the offending path when it refuses.
 * Pure (no fs); run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { sliceFilesResolveInRepo } from "./sliceRepoGuard";

// A board repo root that exists nowhere — the guard is purely lexical.
const REPO = path.resolve("/board/repo");

test("accepts repo-relative files inside the board repo → ok", () => {
  const r = sliceFilesResolveInRepo(REPO, [
    "src/foo.ts",
    "a/b/c.md",
    "./x.ts", // normalizes to x.ts, still inside
  ]);
  assert.deepEqual(r, { ok: true });
});

test("rejects an absolute path — even one pointing inside the repo", () => {
  const inside = path.join(REPO, "src/foo.ts");
  const r = sliceFilesResolveInRepo(REPO, [inside]);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.offending.includes(inside));
  assert.ok(!r.ok && r.reason.includes(inside));
});

test("rejects a `..`-escaping path that resolves outside the repo root", () => {
  const escaping = "../sibling/x.ts";
  const r = sliceFilesResolveInRepo(REPO, ["src/ok.ts", escaping]);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.offending.includes(escaping));
  // The valid sibling file must NOT be flagged.
  assert.ok(!r.ok && !r.offending.includes("src/ok.ts"));
});

test("rejects a different-repo path (absolute into another checkout)", () => {
  const otherRepo = path.resolve("/other/repo/src/y.ts");
  const r = sliceFilesResolveInRepo(REPO, [otherRepo]);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.offending.includes(otherRepo));
});

test("reason names every offending path so the author can fix it", () => {
  const absolute = path.join(REPO, "src/foo.ts");
  const escaping = "../sibling/x.ts";
  const r = sliceFilesResolveInRepo(REPO, [absolute, escaping, "src/ok.ts"]);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.offending.length === 2);
  assert.ok(!r.ok && r.reason.includes(absolute));
  assert.ok(!r.ok && r.reason.includes(escaping));
});

test("empty file list is trivially ok", () => {
  assert.deepEqual(sliceFilesResolveInRepo(REPO, []), { ok: true });
});

test("empty / non-string entries are rejected defensively", () => {
  const r = sliceFilesResolveInRepo(REPO, ["", "   "]);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.offending.length === 2);
});
