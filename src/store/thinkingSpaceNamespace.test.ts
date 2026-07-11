/**
 * Unit tests for the org segment resolver. Pure —
 * `resolveOrg` takes the name string directly, so no git is spawned and the test
 * is independent of ambient git state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveOrg, containerSegment } from "./thinkingSpaceNamespace";

test("resolveOrg sanitizes git user.name into a filesystem-safe segment", () => {
  // A plain name → spaces collapse to dashes (the containerSegment convention).
  assert.equal(resolveOrg("Alex Martinez"), "Alex-Martinez");
  // Leading/trailing whitespace is trimmed before sanitizing.
  assert.equal(resolveOrg("  Alex Martinez  "), "Alex-Martinez");
  // Path separators are neutralized so the segment can't escape its directory.
  assert.equal(resolveOrg("a/b\\c"), "a-b-c");
  // Runs of whitespace collapse to a single dash.
  assert.equal(resolveOrg("Two   Words"), "Two-Words");
  // Single source of sanitization: resolveOrg === containerSegment(trimmed name).
  assert.equal(
    resolveOrg("Some Maintainer"),
    containerSegment("Some Maintainer"),
  );
});

test("resolveOrg fails fast when user.name is unset/empty — no default org", () => {
  // No name configured at all.
  assert.throws(() => resolveOrg(undefined), /organization/i);
  // Empty string.
  assert.throws(() => resolveOrg(""), /organization/i);
  // Whitespace-only names are treated as empty (no segment can be derived).
  assert.throws(() => resolveOrg("   "), /organization/i);
  assert.throws(() => resolveOrg("\t\n"), /organization/i);
  // The error names git user.name so the fix is obvious.
  assert.throws(() => resolveOrg(""), /user\.name/);
});
