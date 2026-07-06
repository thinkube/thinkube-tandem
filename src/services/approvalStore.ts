// Side-channel approval-token store (SP-6/3, TEP-6).
//
// The human-approval gate works only if the agent never handles the token: the ReviewPanel's
// Approve button (extension host) mints a token and `put`s it here; the MCP server's
// `create_slice` gate `get`s it back and verifies. The token therefore travels host → disk →
// server — it is **never presented through a tool call**, so the agent cannot carry, forge,
// or replay it. This module is that disk hop: a tiny file-per-subject store persisted under
// `storageDir` (in production the extension's `globalStorage` path, which the server self-locates
// from its own invocation path, SP-6/17), keyed by the kind-namespaced `subjectKey` (e.g. `spec:TEP-6/SP-3`).
//
// Design notes:
//   - **One file per subject** under `<storageDir>/approvals/`, so approvals for different
//     subjects can never clobber each other and a re-approval simply overwrites its own file.
//   - `subjectKey` contains `:` and `/`, which are not filename-safe — the key is encoded as
//     base64url for the file name (reversible for debugging, collision-free, safe on every OS).
//   - Files are written owner-only (`0o600`) via a same-directory temp file + rename, so the
//     gate never reads a half-written token, mirroring the secret handling in `acSignature`.
//   - The store carries **opaque strings only**: it does no verification and holds no secret.
//     A stale, forged, or corrupted entry is harmless — `verifyApproval` (the sibling
//     `approvalToken` module) is the only judge, so `get` returns whatever is on disk and
//     never throws.
//
// Pure Node (`node:fs`, `node:path`, `node:crypto`) — no VS Code API — so both the extension
// host and the detached MCP server process can use it, and it is unit-testable against a temp dir.
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { ApprovalToken } from "./approvalToken";

/** Subdirectory of `storageDir` holding one token file per subject. */
export const APPROVAL_STORE_DIR = "approvals";

/**
 * The side-channel token store: `put` is called by the host on Approve, `get` by the gate at
 * `create_slice` / spec→Ready. Both ends construct it over the same `storageDir`
 * (the host's globalStorage path, which the server self-locates, SP-6/17), which is how the token
 * crosses the process boundary without ever appearing in a tool call.
 */
export interface ApprovalStore {
  put(subjectKey: string, token: ApprovalToken): void;
  get(subjectKey: string): ApprovalToken | undefined;
}

/**
 * Encode a `subjectKey` (e.g. `spec:TEP-6/SP-3`) into a filename-safe token-file name.
 * base64url keeps the mapping injective (two subjects can never share a file) and reversible.
 */
function tokenFileName(subjectKey: string): string {
  return `${Buffer.from(subjectKey, "utf8").toString("base64url")}.token`;
}

/**
 * Create an {@link ApprovalStore} persisted under `storageDir`.
 *
 * The directory is only materialized when a token is first written — constructing the store
 * (as the gate does on every armed call) leaves the filesystem untouched, and `get` on an
 * empty or missing store simply returns `undefined`.
 */
export function createApprovalStore(storageDir: string): ApprovalStore {
  const dir = join(storageDir, APPROVAL_STORE_DIR);

  return {
    put(subjectKey: string, token: ApprovalToken): void {
      mkdirSync(dir, { recursive: true });
      const finalPath = join(dir, tokenFileName(subjectKey));
      // Write-then-rename within the same directory: the reader either sees the previous
      // token or the new one, never a partial write. Owner-only mode matches the secret file.
      const tempPath = `${finalPath}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        writeFileSync(tempPath, token, { encoding: "utf8", mode: 0o600 });
        renameSync(tempPath, finalPath);
      } catch (err) {
        // Best-effort cleanup so a failed write doesn't strand temp files beside the store.
        rmSync(tempPath, { force: true });
        throw err;
      }
    },

    get(subjectKey: string): ApprovalToken | undefined {
      const tokenPath = join(dir, tokenFileName(subjectKey));
      if (!existsSync(tokenPath)) {
        return undefined;
      }
      try {
        const token = readFileSync(tokenPath, "utf8");
        // An empty file carries no approval; report "absent" rather than an empty token.
        return token.length > 0 ? token : undefined;
      } catch {
        // Unreadable ≡ absent: the gate's answer to any doubt is "no valid approval", and
        // `verifyApproval(undefined, …)` yields exactly that.
        return undefined;
      }
    },
  };
}
