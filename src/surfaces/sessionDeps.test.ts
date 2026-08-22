/**
 * resolveSpaceHandle: the one place a thinking space is resolved to what a
 * session is built with — its display name, read from the space listing
 * and never the repository or project label, and its owner-and-slug key,
 * so a caller addresses the tab register with the key the resolving act
 * itself used rather than a remembered active slug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveSpaceHandle } from "./sessionDeps";
import { createThinkingSpace } from "../core/spaces";

function tmpStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sessiondeps-"));
}

test("resolving a space returns the display name of its own thinking space, taken from the space listing rather than the repository or project label", () => {
  const storeRoot = tmpStore();
  const created = createThinkingSpace(storeRoot, "owner-x", "Plugin delivery", "repository");
  assert.ok(created.ok);
  if (!created.ok) return;

  const handle = resolveSpaceHandle(storeRoot, "owner-x", "owner-x", created.slug, "repository");
  assert.equal(
    handle.name,
    "Plugin delivery",
    "the resolved handle must carry the space's own display name",
  );
  assert.notEqual(
    handle.name,
    "Repository Label",
    "the space's display name must never fall back to a repository or project label — none was even supplied",
  );
});

test("resolving a space returns its owner-and-slug key beside the session, and each space's own key never collides with another's", () => {
  const storeRoot = tmpStore();
  const rebrand = createThinkingSpace(storeRoot, "owner-x", "Rebrand", "repository");
  const main = createThinkingSpace(storeRoot, "owner-x", "Main", "repository");
  assert.ok(rebrand.ok && main.ok);
  if (!rebrand.ok || !main.ok) return;

  const s = resolveSpaceHandle(storeRoot, "owner-x", "owner-x", rebrand.slug, "repository");
  const other = resolveSpaceHandle(storeRoot, "owner-x", "owner-x", main.slug, "repository");

  assert.equal(s.key, `owner-x/${rebrand.slug}`, "the session must carry the owner-and-slug key it was resolved under");
  assert.equal(other.key, `owner-x/${main.slug}`);
  assert.notEqual(
    s.key,
    other.key,
    "each session's key must be its own space's key, not a shared remembered slug",
  );
});
