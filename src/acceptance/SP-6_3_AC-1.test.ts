/**
 * SP-6/3 (TEP-6) AC1 — `create_slice` / →Ready refuse without a valid, recent approval.
 *
 * Driven through the real `create_slice` TOOL CALL (`dispatchTool`, the layer the
 * live MCP server runs) — the sole entry point of the spec→Ready gate (there is no
 * separate →Ready tool; refusing `create_slice` IS refusing the transition).
 *
 * What this proves, with the gate ARMED (`THINKUBE_APPROVAL_DIR` set):
 *   1. REFUSED — with NO approval in the side-channel store, `create_slice` throws,
 *      the refusal names the missing approval and directs to the Approve action,
 *      and NO slice file is created (the refusal is total).
 *   2. Positive control — the *same* call clears the gate once a valid approval
 *      (minted for this subject + the current spec content, under the server
 *      approval secret, fresh within TTL) sits in the store — proving the refusal
 *      in (1) was specifically the missing approval, not an always-failing gate.
 *   3. Disarmed control — with `THINKUBE_APPROVAL_DIR` unset the legacy path still
 *      creates the slice — proving the arming (read per call) is what refuses.
 *
 * This test CONSUMES the approval-token contract (`mintApproval`,
 * `approvalContentHash`, `loadOrCreateApprovalSecret` from approvalToken.ts and
 * `createApprovalStore` from approvalStore.ts) to seed the store exactly the way
 * the host's Approve button does — it never re-derives hashing or signing, so a
 * contract drift surfaces here instead of silently passing.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { dispatchTool } from "../mcp/kanbanMcpServer";
import {
  mintApproval,
  approvalContentHash,
  loadOrCreateApprovalSecret,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";

// ── scaffolding (mirrors createSliceDagGate.test.ts / specGateDispatch.test.ts) ──

// The composite `<tep>/<spec>` id → the gate's kind-namespaced subject.
const SPEC = "1/1";
const SUBJECT_KEY = "spec:TEP-1/SP-1";

/** A fresh thinking space seeded with a Spec that clears every OTHER →Ready gate
 *  (structural AC + a non-file-pinned runnable verification), so the only thing
 *  left to decide is the human-approval gate under test. */
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-approval-gate-thinking space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-x", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

const createSlice = (store: ThinkubeStore) =>
  dispatchTool(
    "create_slice",
    { spec: SPEC, title: "gated slice", body: "detail", files: ["src/foo.ts"] },
    ctxFor(store),
    () => {},
  );

/** Run `fn` with the gate ARMED on a fresh approval dir (the env var is read
 *  PER CALL, so setting it just before the call is exactly the live arming),
 *  restoring the previous environment afterwards so tests can't cross-pollute. */
async function withArmedGate(
  fn: (approvalDir: string) => Promise<void>,
): Promise<void> {
  const approvalDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-approval-dir-"),
  );
  const prev = process.env.THINKUBE_APPROVAL_DIR;
  process.env.THINKUBE_APPROVAL_DIR = approvalDir;
  try {
    await fn(approvalDir);
  } finally {
    if (prev === undefined) delete process.env.THINKUBE_APPROVAL_DIR;
    else process.env.THINKUBE_APPROVAL_DIR = prev;
  }
}

/** Read the CURRENT spec body off the store — the exact document the gate hashes. */
async function currentSpecBody(store: ThinkubeStore): Promise<string> {
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the seeded spec doc must exist");
  return doc!.body;
}

// ── AC1 core: armed gate + empty store → total refusal ───────────────────────

test("ARMED + no approval in the store: create_slice is REFUSED, naming the missing approval and the Approve action", async () => {
  await withArmedGate(async () => {
    const store = await seededStore();

    await assert.rejects(
      () => createSlice(store),
      (err: unknown) => {
        const msg = (err as Error).message;
        // The refusal NAMES the missing approval…
        assert.match(
          msg,
          /approval/i,
          `the refusal must name the missing approval (got: ${msg})`,
        );
        // …and DIRECTS the caller to the Approve action (the human's UI button).
        // Word-boundary match: the bare noun "approval" does NOT satisfy this —
        // the message must actually name the Approve action/verb.
        assert.match(
          msg,
          /\bapprove\b/i,
          `the refusal must direct to the Approve action (got: ${msg})`,
        );
        return true;
      },
    );

    // The refusal is total: no slice file was created — the spec never
    // transitioned toward Ready.
    assert.deepEqual(
      await store.listSlices(SPEC),
      [],
      "a create_slice refused at the approval gate must not persist a slice file",
    );
  });
});

// ── Positive control: a valid approval in the store clears the SAME call ─────
// Without this, the refusal above could be an always-failing gate rather than
// one keyed to the store's contents.

test("ARMED + a valid approval in the store: the same create_slice clears the gate (refusal was the missing approval)", async () => {
  await withArmedGate(async (approvalDir) => {
    const store = await seededStore();

    // Deliver a token exactly the way the host's Approve button does: mint over
    // (subjectKey, hash of the CURRENT spec body, now) under the server secret
    // persisted in the approval dir, and put it in the side-channel store.
    const secret = loadOrCreateApprovalSecret(approvalDir);
    const token = mintApproval(
      SUBJECT_KEY,
      approvalContentHash(await currentSpecBody(store)),
      Date.now(),
      secret,
    );
    createApprovalStore(approvalDir).put(SUBJECT_KEY, token);

    const res = (await createSlice(store)) as { slice: string };
    assert.match(
      res.slice,
      /^TEP-1_SP-1_SL-\d+$/,
      "a fresh, subject- and content-bound approval must satisfy the armed gate",
    );
    assert.equal(
      (await store.listSlices(SPEC)).length,
      1,
      "the approved create_slice must persist the slice file",
    );
  });
});

// ── Disarmed control: the env var is causal (read per call; legacy path kept) ─

test("DISARMED (THINKUBE_APPROVAL_DIR unset): create_slice succeeds with no approval — the arming is what refuses", async () => {
  const prev = process.env.THINKUBE_APPROVAL_DIR;
  delete process.env.THINKUBE_APPROVAL_DIR;
  try {
    const store = await seededStore();
    const res = (await createSlice(store)) as { slice: string };
    assert.match(
      res.slice,
      /^TEP-1_SP-1_SL-\d+$/,
      "with the gate off the legacy pre-approval path must be preserved",
    );
  } finally {
    if (prev !== undefined) process.env.THINKUBE_APPROVAL_DIR = prev;
  }
});
