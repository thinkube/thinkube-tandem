/**
 * SP-6/20 (TEP-6) AC2 — `start_spec_worktree` self-locates its control dir and hands off
 * WITHOUT `THINKUBE_CONTROL_DIR`.
 *
 * SP-6/17 gave the approval store a lexical self-location from the server's own invocation path
 * (`resolveApprovalDir(process.argv[1])`); this spec extends the same derivation to the two
 * control-request tools. The control dir is now `<globalStorage>/control` —
 * `path.join(resolveApprovalDir(process.argv[1]), "control")` — with NO env read and no
 * "env not set" refusal. So a session spawned from a project-scope `.mcp.json` (which carries no
 * machine-local dirs) can still open a worktree.
 *
 * Driven through the real `start_spec_worktree` TOOL CALL (`dispatchTool`, the layer the live MCP
 * server runs) — the only public seam — with `THINKUBE_CONTROL_DIR` DELETED from the environment
 * and `process.argv[1]` rooted at an install-shaped path
 * (`<gs>/extension-current/dist/mcp/kanbanMcpServer.js`), exactly the SP-6/17 `withArmedGate`
 * idiom. What this proves:
 *
 *   1. The call SUCCEEDS — no `env not set` rejection — and its success result carries
 *      `request` = the absolute path of the written request file.
 *   2. That file is `start-worktree-<hex(spec)>.json` under the INVOCATION-DERIVED
 *      `<gs>/control` dir (created if missing), and its bytes are the serialized request.
 *   3. The env var, if present, is IGNORED — a decoy `THINKUBE_CONTROL_DIR` pointing elsewhere
 *      does not divert the write; the invocation path alone decides (SP-6/17's "always armed,
 *      no off state" model, mirrored here).
 *
 * CONSUMES the real seams — the exported `dispatchTool` (kanbanMcpServer.ts) and the exported
 * `startWorktreeRequestFile` (controlRequests.ts) — rather than re-deriving the filename or the
 * path math, so a contract drift surfaces here instead of silently passing. `resolveControlDir`
 * is the pure derivation the handler uses; the expected dir is re-derived here from the same
 * lexical rule (`<gs>/control`) so this probe stays a black-box check of where the file lands.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";
import { startWorktreeRequestFile } from "../mcp/controlRequests";

// The env var the handler must NOT read (referenced literally — src/acceptance/ is excluded from
// the AC3 "no reference in src/" search, so this does not defeat the retirement check).
const CONTROL_DIR_ENV = "THINKUBE_CONTROL_DIR";

// The spec whose worktree we hand off. `start_spec_worktree` does no id resolution — this exact
// string is what `startWorktreeRequestFile` hex-encodes into the request filename.
const SPEC = "6/20";

/** A minimal store for the handler: `dispatchTool` reads `store.thinkubeDir` (write-lock handle)
 *  and `start_spec_worktree` passes `store.workspaceRoot` as the repo. Nothing on disk is read —
 *  the hand-off only WRITES the request file. */
function freshStore(): ThinkubeStore {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-sp20-ac2-ts-"),
  );
  return new ThinkubeStore(thinkingSpace, thinkingSpace);
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

const startWorktree = (store: ThinkubeStore) =>
  dispatchTool("start_spec_worktree", { spec: SPEC }, ctxFor(store), () => {});

/**
 * Run `fn` with `process.argv[1]` rooted at an install-shaped path under a fresh temp
 * globalStorage dir, so the production `resolveControlDir(process.argv[1])` derives
 * `<gs>/control`. Returns nothing; `fn` receives the derived control dir. argv and the env var are
 * restored afterwards so tests can't cross-pollute.
 */
async function withInstallShapedInvocation(
  fn: (controlDir: string, gsDir: string) => Promise<void>,
): Promise<void> {
  const gsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp20-ac2-gs-"));
  // `<gs>/control`, the lexical dir `resolveControlDir` yields from the invocation path below
  // (`resolveApprovalDir` walks three segments up: mcp → dist → extension-current → <gs>).
  const controlDir = path.join(gsDir, "control");
  const prevArgv = process.argv[1];
  process.argv[1] = path.join(
    gsDir,
    "extension-current",
    "dist",
    "mcp",
    "kanbanMcpServer.js",
  );
  try {
    await fn(controlDir, gsDir);
  } finally {
    process.argv[1] = prevArgv;
  }
}

/** Run `fn` with `THINKUBE_CONTROL_DIR` deleted from the environment, restored afterwards. */
async function withEnvDeleted(fn: () => Promise<void>): Promise<void> {
  const prev = process.env[CONTROL_DIR_ENV];
  delete process.env[CONTROL_DIR_ENV];
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[CONTROL_DIR_ENV];
    else process.env[CONTROL_DIR_ENV] = prev;
  }
}

// ── AC2 core: env absent → success, file written under the invocation-derived control dir ──

test("start_spec_worktree succeeds with THINKUBE_CONTROL_DIR absent, writing the request under <gs>/control", async () => {
  await withEnvDeleted(async () => {
    await withInstallShapedInvocation(async (controlDir) => {
      const store = freshStore();

      // Must NOT throw an "env not set" refusal — the dir is derived from the invocation path.
      const res = (await startWorktree(store)) as {
        ok: boolean;
        request: string;
      };

      assert.equal(res.ok, true, "the hand-off result must report success");

      // The result carries the ABSOLUTE path of the written request file.
      assert.equal(
        path.isAbsolute(res.request),
        true,
        `request must be an absolute path (got: ${res.request})`,
      );

      // …which is `start-worktree-<hex(spec)>.json` under the invocation-derived <gs>/control —
      // consuming the real `startWorktreeRequestFile` for the name, so a filename drift fails here.
      const expected = path.join(controlDir, startWorktreeRequestFile(SPEC));
      assert.equal(
        res.request,
        expected,
        "the request file must land under the invocation-derived control dir with the hashed name",
      );

      // The dir was created if missing and the file actually exists on disk with the request bytes.
      assert.equal(
        fs.existsSync(res.request),
        true,
        "the request file must be written to disk",
      );
      const written = fs.readFileSync(res.request, "utf8");
      assert.match(
        written,
        /"kind":"start-worktree"/,
        "the written file must carry the serialized start-worktree request",
      );
      assert.match(
        written,
        new RegExp(`"spec":"${SPEC}"`),
        "the written request must carry the spec id",
      );
    });
  });
});

// ── the env var is IGNORED when present — the invocation path alone decides ──
// Proves the derivation is structural (SP-6/17's "no off state, no override"), not merely a
// fallback when the env is unset: a decoy dir must not divert the write.

test("a present THINKUBE_CONTROL_DIR is IGNORED — the write still lands under the invocation-derived control dir", async () => {
  const decoy = fs.mkdtempSync(path.join(os.tmpdir(), "tk-sp20-ac2-decoy-"));
  const prev = process.env[CONTROL_DIR_ENV];
  process.env[CONTROL_DIR_ENV] = decoy;
  try {
    await withInstallShapedInvocation(async (controlDir) => {
      const store = freshStore();
      const res = (await startWorktree(store)) as {
        ok: boolean;
        request: string;
      };

      const expected = path.join(controlDir, startWorktreeRequestFile(SPEC));
      assert.equal(
        res.request,
        expected,
        "the env var must not divert the write away from the invocation-derived control dir",
      );
      // The decoy dir must be untouched — nothing was written there.
      assert.equal(
        fs.existsSync(path.join(decoy, startWorktreeRequestFile(SPEC))),
        false,
        "no request file may be written into the env-named decoy dir",
      );
    });
  } finally {
    if (prev === undefined) delete process.env[CONTROL_DIR_ENV];
    else process.env[CONTROL_DIR_ENV] = prev;
  }
});
