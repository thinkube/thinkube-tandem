/**
 * SP-6/17 (TEP-6) AC1 — the **exported** pure resolver `resolveApprovalDir(invocationPath)`
 * returns the globalStorage store directory by **lexical path arithmetic** over the server's own
 * invocation path, with no filesystem or symlink resolution and no env consulted.
 *
 * The server runs as `…/thinkube.thinkube-ai-integration/extension-current/dist/mcp/kanbanMcpServer.js`,
 * so walking three segments up (mcp → dist → extension-current) must land at the globalStorage
 * extension dir `…/thinkube.thinkube-ai-integration`, exactly where the host's Approve button writes.
 *
 * Proof of "lexical, not realpath, no fs":
 *   - a non-existent install path resolves fine (a `realpath` would throw / diverge on a missing path);
 *   - the `extension-current` symlink segment is PRESERVED in the walk (not resolved away);
 *   - the result is invariant to any environment variable.
 *
 * CONSUMES the exported `resolveApprovalDir` from kanbanMcpServer.ts — driving the real seam, not a
 * re-derivation of the path math, so a contract drift surfaces here.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { resolveApprovalDir } from "../mcp/kanbanMcpServer";

// An install-shaped invocation path and the globalStorage dir three segments above it.
const GLOBAL_STORAGE = path.join(
  "/home/thinkube/.config/Code/User/globalStorage",
  "thinkube.thinkube-ai-integration",
);
const INVOCATION = path.join(
  GLOBAL_STORAGE,
  "extension-current",
  "dist",
  "mcp",
  "kanbanMcpServer.js",
);

test("resolveApprovalDir walks the install-shaped path up to the globalStorage extension dir", () => {
  assert.equal(resolveApprovalDir(INVOCATION), GLOBAL_STORAGE);
});

test("resolveApprovalDir is purely lexical — a NON-EXISTENT path resolves the same, no fs/realpath", () => {
  const missingBase = path.join(
    "/nonexistent-zzz-does-not-exist",
    "thinkube.thinkube-ai-integration",
  );
  const missingInvocation = path.join(
    missingBase,
    "extension-current",
    "dist",
    "mcp",
    "kanbanMcpServer.js",
  );
  // A realpath-based resolver would throw (ENOENT) or diverge on this missing path;
  // pure lexical arithmetic returns the parent dir without touching the filesystem.
  assert.equal(resolveApprovalDir(missingInvocation), missingBase);
});

test("resolveApprovalDir is invariant to the environment", () => {
  const prev = process.env.THINKUBE_APPROVAL_DIR;
  try {
    process.env.THINKUBE_APPROVAL_DIR = "/some/completely/other/dir";
    assert.equal(resolveApprovalDir(INVOCATION), GLOBAL_STORAGE);
    delete process.env.THINKUBE_APPROVAL_DIR;
    assert.equal(resolveApprovalDir(INVOCATION), GLOBAL_STORAGE);
  } finally {
    if (prev === undefined) delete process.env.THINKUBE_APPROVAL_DIR;
    else process.env.THINKUBE_APPROVAL_DIR = prev;
  }
});
