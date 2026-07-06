// Test-support for the always-armed human-approval gate (SP-6/17). NOT shipped — excluded from the
// dist build in tsconfig.json; compiled into out-test by tsconfig.test.json for the node:test suite.
//
// SP-6/17 removed the gate's off state: `create_slice` (the spec→Ready transition) now ALWAYS
// verifies a maintainer approval, self-locating its store from `process.argv[1]`
// (`resolveApprovalDir`) with no env var and no opt-out. Any test that drives `create_slice` past
// the approval gate — to success, or to a DOWNSTREAM gate (AC / DAG / footprint / retires /
// contract), all of which run AFTER the approval check — must therefore seed a valid, content-bound
// approval into the store the gate resolves to.
//
// This helper does exactly what the host's Approve button does, minus the UI: it roots
// `process.argv[1]` at a per-process temp store (so `resolveApprovalDir(process.argv[1])` lands on
// it) and mints an approval over a spec's CURRENT body. It grants ONLY the approval signal — every
// other create_slice gate still applies unchanged, so a refusal test still refuses for its own
// reason, just with the right error instead of a spurious approval error.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ThinkubeStore } from "../store/ThinkubeStore";
import {
  approvalContentHash,
  loadOrCreateApprovalSecret,
  mintApproval,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";

let approvalDir: string | undefined;

/**
 * The temp approval store `create_slice` resolves to. Created once per test process and wired via
 * `process.argv[1] = <dir>/extension-current/dist/mcp/kanbanMcpServer.js`, so the production
 * `resolveApprovalDir(process.argv[1])` (three lexical segments up) returns exactly this dir — no
 * env var, matching SP-6/17's self-location.
 */
export function testApprovalDir(): string {
  if (approvalDir === undefined) {
    approvalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-test-approval-"));
    process.argv[1] = path.join(
      approvalDir,
      "extension-current",
      "dist",
      "mcp",
      "kanbanMcpServer.js",
    );
  }
  return approvalDir;
}

/**
 * Seed a valid, content-bound approval for `spec` (the composite `<tep>/<sp>` id) over its CURRENT
 * body, so `create_slice`'s always-armed gate clears. Idempotent; safe to call before every
 * `create_slice` (re-mints against the latest body, so it also covers a spec edited mid-test). A
 * no-op when the spec doc is absent (that path refuses before the approval gate anyway).
 */
export async function armApprovalForSlicing(
  store: ThinkubeStore,
  spec: string,
): Promise<void> {
  const dir = testApprovalDir();
  const doc = await store.getFile(store.pathForSpecDoc(spec));
  if (!doc) return;
  const [tep, sp] = spec.split("/");
  const subjectKey = `spec:TEP-${tep}/SP-${sp}`;
  const secret = loadOrCreateApprovalSecret(dir);
  const token = mintApproval(
    subjectKey,
    approvalContentHash(doc.body),
    Date.now(),
    secret,
  );
  createApprovalStore(dir).put(subjectKey, token);
}
