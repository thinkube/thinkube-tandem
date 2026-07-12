// SP-1/1 AC-1 — package.json and package-lock.json carry the thinkube-tandem identity.
//
// Reads the two manifest files synchronously from the project root (two levels up from the
// compiled output at out-test/acceptance/) and asserts the six identity fields specified by
// AC-1. No module imports, no build artefact, no Extension-Host: runs before any
// implementation work exists and describes WHAT must be true, not HOW it is achieved.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Compiled output: out-test/acceptance/SP-1_1_AC-1.test.js → project root is two levels up.
const ROOT = path.resolve(__dirname, "../..");

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, relPath), "utf8"),
  ) as Record<string, unknown>;
}

// WHY TRANSITION: the extension package name is the seed for the extension id
// (thinkube.thinkube-tandem), the vsix filename, and globalStorage paths — all downstream
// from this field. Proves it was set to the new Tandem identity. Done once the rename ships.
test("package.json name is 'thinkube-tandem'", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.name,
    "thinkube-tandem",
    "package.json name must be 'thinkube-tandem'",
  );
});

// WHY TRANSITION: displayName is the user-facing label in the Extensions panel and the
// activity-bar tooltip. Proves the UI label was updated to the Thinkube Tandem brand.
// Done once the rename ships.
test("package.json displayName is 'Thinkube Tandem'", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.displayName,
    "Thinkube Tandem",
    "package.json displayName must be 'Thinkube Tandem'",
  );
});

// WHY INVARIANT: the extension id is '<publisher>.<name>'. Changing publisher silently mints
// a new id and orphans every installed globalStorage entry (signing keys, approval tokens).
// This guard must live forever to catch accidental future alterations.
test("package.json publisher is 'thinkube' (unchanged — anchors the extension id)", () => {
  const pkg = readJson("package.json");
  assert.equal(
    pkg.publisher,
    "thinkube",
    "publisher must remain 'thinkube'; changing it creates a new extension id and orphans globalStorage",
  );
});

// WHY TRANSITION: repository.url records the canonical GitHub home for the renamed repo.
// The AC specifies this as a string field check only — URL resolution is an out-of-band ops
// concern. Proves the field was updated as part of the rename. Done once the rename ships.
test("package.json repository.url is 'https://github.com/thinkube/thinkube-tandem'", () => {
  const pkg = readJson("package.json");
  const repo = pkg.repository as { url?: string } | undefined;
  assert.ok(
    repo != null && typeof repo === "object",
    "package.json must have a 'repository' object field",
  );
  assert.equal(
    repo!.url,
    "https://github.com/thinkube/thinkube-tandem",
    "repository.url must be 'https://github.com/thinkube/thinkube-tandem'",
  );
});

// WHY TRANSITION: npm writes 'name' at the lockfile top level independently of the manifest.
// Proves the lockfile was regenerated (not just the manifest hand-edited) so the rename is
// coherent across all npm artefacts. Done once the lockfile is regenerated after the rename.
test("package-lock.json top-level name is 'thinkube-tandem'", () => {
  const lock = readJson("package-lock.json");
  assert.equal(
    lock.name,
    "thinkube-tandem",
    "package-lock.json top-level name must be 'thinkube-tandem' — regenerate the lockfile after renaming package.json",
  );
});

// WHY TRANSITION: npm also writes 'name' inside the packages[""] root-package record.
// Both lockfile name fields must agree with package.json or tooling can misidentify the
// package. Done once the lockfile is regenerated and both entries agree.
test("package-lock.json packages[''].name is 'thinkube-tandem'", () => {
  const lock = readJson("package-lock.json");
  const packages = lock.packages as
    Record<string, Record<string, unknown>> | undefined;
  assert.ok(
    packages != null && packages[""] != null,
    "package-lock.json must have a packages[''] entry (the root package record)",
  );
  assert.equal(
    packages![""].name,
    "thinkube-tandem",
    "packages[''].name must be 'thinkube-tandem' — both lockfile name fields must agree",
  );
});
