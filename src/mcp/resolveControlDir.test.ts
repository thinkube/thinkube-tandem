/**
 * Unit test for `resolveControlDir(invocationPath)` — the control-request dir the host's
 * ControlRequestWatcher watches, self-located from the server's own invocation path the SAME way
 * `resolveApprovalDir` locates the approval store (SP-6/17), one directory deeper (`<globalStorage>/
 * control`). Deriving it structurally makes the open-review / start-worktree hand-off reachable even
 * when a session's MCP registration never injected `THINKUBE_CONTROL_DIR` — the regression this
 * covers. Purely lexical: no filesystem access, so a non-existent path resolves the same. Run via
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { resolveControlDir, resolveApprovalDir } from "./kanbanMcpServer";

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

test("resolveControlDir lands at <globalStorage>/control — the sibling of the approval dir", () => {
  assert.equal(
    resolveControlDir(INVOCATION),
    path.join(GLOBAL_STORAGE, "control"),
  );
  assert.equal(
    resolveControlDir(INVOCATION),
    path.join(resolveApprovalDir(INVOCATION), "control"),
  );
});

test("resolveControlDir is purely lexical — a NON-EXISTENT path resolves the same, no fs/realpath", () => {
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
  assert.equal(
    resolveControlDir(missingInvocation),
    path.join(missingBase, "control"),
  );
});
