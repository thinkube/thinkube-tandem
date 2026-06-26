/**
 * AC#2 — the self-link guard (SP-th4wqh).
 *
 * `nodeModulesLinkSafe(target, repoRoot)` operates on **`fs.realpath`-resolved**
 * paths: it refuses a link that resolves to point a repo's deps dir at itself —
 * including the `a/../node_modules` spelling, a trailing slash, and a symlinked
 * root — and allows a distinct target. And the guard is **wired at the call
 * site**: `linkNodeModules` consults it *before* `fs.symlink`, so a would-be
 * self-link is refused rather than created (asserted by behaviour at the call
 * site, not just on the helper). Hermetic tmp dirs; run via `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { nodeModulesLinkSafe, linkNodeModules } from "./WorktreeService";

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "tk-nml-"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

// ── the pure helper, over realpath-resolved spellings ──────────────────────

test("safe: a distinct target is allowed", async () => {
  const repo = tmp();
  const shared = tmp();
  await fs.mkdir(path.join(shared, "node_modules"));
  assert.equal(
    await nodeModulesLinkSafe(path.join(shared, "node_modules"), repo),
    true,
  );
});

test("self: plain repoRoot/node_modules is refused", async () => {
  const repo = tmp();
  assert.equal(
    await nodeModulesLinkSafe(path.join(repo, "node_modules"), repo),
    false,
  );
});

test("self: the `a/../node_modules` spelling resolves to itself and is refused", async () => {
  const repo = tmp();
  const spelled = path.join(repo, "a", "..", "node_modules");
  assert.equal(await nodeModulesLinkSafe(spelled, repo), false);
});

test("self: a trailing slash on repoRoot still resolves to itself", async () => {
  const repo = tmp();
  assert.equal(
    await nodeModulesLinkSafe(path.join(repo, "node_modules"), repo + path.sep),
    false,
  );
});

test("self: a symlinked repo root resolves through and is refused", async () => {
  const real = tmp();
  await fs.mkdir(path.join(real, "node_modules"));
  const link = tmp();
  const aliasRoot = path.join(link, "alias");
  await fs.symlink(real, aliasRoot, "dir");
  // target names the real node_modules; repoRoot is reached via the symlink —
  // realpath collapses both to real/node_modules, so it's a self-link.
  assert.equal(
    await nodeModulesLinkSafe(path.join(real, "node_modules"), aliasRoot),
    false,
  );
});

// ── the call site: linkNodeModules must consult the guard before fs.symlink ──

test("call site: a safe target is linked (fs.symlink runs)", async () => {
  const shared = tmp();
  await fs.mkdir(path.join(shared, "node_modules"));
  const wt = tmp();

  const result = await linkNodeModules(path.join(shared, "node_modules"), wt);

  assert.equal(result, "linked");
  const dst = path.join(wt, "node_modules");
  assert.ok((await fs.lstat(dst)).isSymbolicLink());
  assert.equal(
    await fs.realpath(dst),
    await fs.realpath(path.join(shared, "node_modules")),
  );
});

test("call site: a self-referential link is REFUSED before fs.symlink", async () => {
  const wt = tmp();
  // The would-be link target resolves to wt/node_modules itself (via a/..).
  const selfTarget = path.join(wt, "a", "..", "node_modules");

  const result = await linkNodeModules(selfTarget, wt);

  assert.equal(result, "refused");
  // The guard gated fs.symlink — no self-link was ever created.
  assert.equal(
    await exists(path.join(wt, "node_modules")),
    false,
    "linkNodeModules must not create the self-referential link",
  );
});

test("call site: a pre-existing node_modules is left untouched (idempotent)", async () => {
  const shared = tmp();
  await fs.mkdir(path.join(shared, "node_modules"));
  const wt = tmp();
  await fs.mkdir(path.join(wt, "node_modules")); // already present

  const result = await linkNodeModules(path.join(shared, "node_modules"), wt);

  assert.equal(result, "skipped");
  // Still a real dir, not replaced by a symlink.
  assert.equal(
    (await fs.lstat(path.join(wt, "node_modules"))).isSymbolicLink(),
    false,
  );
});
