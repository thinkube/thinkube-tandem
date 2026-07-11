/**
 * Unit tests for the write-time secret scanner. Run via `npm test`, which
 * compiles this + its source to out-test/ and executes it with Node's built-in
 * test runner (`node --test`). `scanForSecrets` is a pure function, so
 * `node:test` + `node:assert` are enough.
 *
 * The aws-secret-key rule used to flag any 40-char base64-ish token at
 * end-of-line. That caught the methodology tooling's own `verified_req_hash`
 * stamp — a 40-char SHA-1 hex digest — so `move_slice → Done` refused to write
 * the very file it was stamping. These tests pin the fix: hashes are not
 * secrets, real AWS keys still are.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scanForSecrets,
  parseFrontmatter,
  serializeFrontmatter,
  effectiveTags,
} from "./frontmatter";

test("a 40-char hex digest in frontmatter is not flagged as an AWS key", () => {
  // A real SHA-1 hex digest (what requirementHash produces), stamped as a
  // frontmatter field on move-to-Done.
  const text = [
    "---",
    "uid: some-slice",
    "status: done",
    "verified_req_hash: da39a3ee5e6b4b0d3255bfef95601890afd80709",
    "---",
    "",
    "Body text.",
  ].join("\n");
  assert.deepEqual(scanForSecrets(text), []);
});

test("a bare 40-char hex digest before a comma is not flagged", () => {
  const text = "hash da39a3ee5e6b4b0d3255bfef95601890afd80709, ok\n";
  assert.deepEqual(scanForSecrets(text), []);
});

test("a real AWS secret key (mixed-case base64) is still flagged", () => {
  // The canonical AWS example secret access key — mixed case, contains a slash.
  const text = "secret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n";
  const hits = scanForSecrets(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "aws-secret-key");
});

test("an AWS access key id is still flagged by its own rule", () => {
  const text = "key: AKIAIOSFODNN7EXAMPLE\n";
  const hits = scanForSecrets(text);
  assert.ok(hits.some((h) => h.pattern === "aws-access-key"));
});

// ── archive flag ──

test("the archived flag round-trips through serialize → parse", () => {
  const text = serializeFrontmatter({
    frontmatter: { implements: "TEP-tg86v7", archived: true },
    body: "# A Spec\n",
  });
  assert.equal(parseFrontmatter(text).frontmatter?.archived, true);
});

test("a file with no archived key parses as not-archived (back-compat)", () => {
  const text = ["---", "implements: TEP-0009", "---", "", "# A Spec"].join(
    "\n",
  );
  assert.equal(parseFrontmatter(text).frontmatter?.archived, undefined);
});

// ── tags mesh ──

test("a tags array round-trips through serialize → parse (order preserved)", () => {
  const text = serializeFrontmatter({
    frontmatter: { uid: "s", tags: ["security", "inference"] },
    body: "# A Spec\n",
  });
  assert.deepEqual(parseFrontmatter(text).frontmatter?.tags, [
    "security",
    "inference",
  ]);
});

test("effectiveTags returns the tags array", () => {
  assert.deepEqual(effectiveTags({ tags: ["a", "b"] }), ["a", "b"]);
});

test("effectiveTags folds a legacy `theme` in as a tag (back-compat, never dropped)", () => {
  assert.deepEqual(effectiveTags({ theme: "rebrand" }), ["rebrand"]);
  // theme is appended after explicit tags, deduped.
  assert.deepEqual(effectiveTags({ tags: ["a"], theme: "b" }), ["a", "b"]);
  assert.deepEqual(effectiveTags({ tags: ["a"], theme: "a" }), ["a"]);
});

test("effectiveTags trims blanks and dedups; undefined fm → []", () => {
  assert.deepEqual(effectiveTags({ tags: ["a", " a ", "", "b"] }), ["a", "b"]);
  assert.deepEqual(effectiveTags(undefined), []);
});
