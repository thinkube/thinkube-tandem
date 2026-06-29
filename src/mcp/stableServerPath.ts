/**
 * Version-stable path for the kanban MCP server (ADR-0007 Phase-6 decision).
 *
 * `.mcp.json` files bake an absolute path to the server script. Pointing them
 * at the extension's install dir is a trap: the dir name carries the version
 * (`…/thinkube.thinkube-ai-integration-0.1.0/…`), so every extension update
 * silently orphans every repo's `.mcp.json`.
 *
 * Fix: a symlink in globalStorage — a deterministic, version-free location —
 * pointing at the CURRENT extension install dir, refreshed on every
 * activation. `.mcp.json` paths go through the symlink and survive updates.
 *
 * Why a symlink and not a copy: Node resolves `require()` from the script's
 * REAL path, so the server's relative imports (`../store/…`) and its
 * `node_modules` lookup (`@modelcontextprotocol/sdk`) keep resolving inside
 * the real extension dir — no bundling, nothing to keep in sync.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const LINK_NAME = "extension-current";

/**
 * Create/refresh the `globalStorage/extension-current` symlink to the current
 * extension install dir. Idempotent; safe to call on every activation.
 */
export async function ensureStableServerLink(
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
