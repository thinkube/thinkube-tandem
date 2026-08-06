/**
 * Version-stable path into the current extension install.
 *
 * Settings that bake an absolute path into the extension's install dir are a
 * trap: the dir name carries the version (`…/thinkube.thinkube-tandem-2.0.0/…`),
 * so every extension update — and the deploy script's stale-version pruning —
 * silently orphans the setting. The fix is a symlink in globalStorage — a
 * deterministic, version-free location — pointing at the CURRENT extension
 * install dir, refreshed on every activation. Paths that go through the
 * symlink survive updates.
 *
 * Why a symlink and not a copy: anything resolved from the script's REAL
 * path (relative imports, node_modules lookup) keeps resolving inside the
 * real extension dir — no bundling, nothing to keep in sync.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const LINK_NAME = "extension-current";

/**
 * A version-stable path INTO the current extension install, resolved through
 * the `extension-current` globalStorage symlink. This is what a setting may
 * safely bake; a pinned, versioned `context.asAbsolutePath(...)` is not.
 */
export function stableExtensionSubpath(
  context: vscode.ExtensionContext,
  ...parts: string[]
): string {
  return path.join(context.globalStorageUri.fsPath, LINK_NAME, ...parts);
}

/**
 * Create/refresh the `globalStorage/extension-current` symlink to the current
 * extension install dir. Idempotent; safe to call on every activation.
 */
export async function ensureStableExtensionLink(
  context: vscode.ExtensionContext,
): Promise<void> {
  const storageDir = context.globalStorageUri.fsPath;
  const linkPath = path.join(storageDir, LINK_NAME);
  const target = context.extensionUri.fsPath;

  await fs.mkdir(storageDir, { recursive: true });
  try {
    const existing = await fs.readlink(linkPath);
    if (existing === target) return; // already current
  } catch {
    // missing or not a symlink — fall through and (re)create
  }
  await fs.rm(linkPath, { recursive: true, force: true });
  // 'junction' is ignored on POSIX and avoids the symlink privilege
  // requirement on Windows (junctions work unprivileged for directories).
  await fs.symlink(target, linkPath, "junction");
}
