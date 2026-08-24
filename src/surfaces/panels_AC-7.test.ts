/**
 * A session, its tab and its pushes must all route through the same one
 * key — spaceKey is the single builder every caller uses, and it must
 * leave a "wp:" project owner key intact rather than stripping or
 * rewriting the prefix that tells the two owner kinds apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceKey } from "../core/spaces";

// INVARIANT: spaceKey is deterministic and stable across repeated calls
// with the same inputs — the one property that lets a session, its tab and
// its pushes agree on the same key without comparing anything but strings.
test("spaceKey returns the same key for the same owner and slug every time", () => {
  const a = spaceKey("repo-1", "main");
  const b = spaceKey("repo-1", "main");
  assert.equal(a, b);
});

// INVARIANT: a "wp:" project owner key is carried through intact inside the
// built key — the prefix that distinguishes a project owner from a
// repository owner is not stripped or altered.
test("spaceKey leaves a wp: project owner key intact in the key it builds", () => {
  const key = spaceKey("wp:proj-1", "rebrand");
  assert.ok(key.includes("wp:proj-1"), `expected the owner key "wp:proj-1" intact in ${key}`);
});

// INVARIANT: different slugs under the same owner must not collide — each
// space keeps its own key so its tab and pushes never cross with a
// sibling space's.
test("spaceKey distinguishes different slugs under the same owner", () => {
  const a = spaceKey("repo-1", "main");
  const b = spaceKey("repo-1", "other");
  assert.notEqual(a, b);
});
