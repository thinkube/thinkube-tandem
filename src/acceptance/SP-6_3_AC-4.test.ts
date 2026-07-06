/**
 * SP-6/3 (TEP-6) AC4 — Approval is content-bound: editing the spec re-arms the gate.
 *
 * "An approval minted for one spec content satisfies the gate; once the spec's
 *  content changes, that same approval no longer verifies (the content hash
 *  differs) and `create_slice` / →Ready refuse until a fresh approval is minted
 *  for the new content."
 *
 * Proven at BOTH layers of the public contract:
 *
 *   Token layer (pure, injectable seams — `verifyApproval`):
 *     a token minted over hash(content A) verifies against hash(A) and fails
 *     against hash(B), everything else (subject, secret) held
 *     constant — so the ONLY moving variable is the content hash. A fresh
 *     token minted over hash(B) then verifies against hash(B).
 *
 *   Gate layer (the real `create_slice` TOOL CALL via `dispatchTool` — the sole
 *   entry point of the spec→Ready transition):
 *     1. SATISFIES — with the gate ARMED and an approval minted for the CURRENT
 *        spec content in the side-channel store, `create_slice` succeeds.
 *     2. RE-ARMS — the spec body is edited (content hash moves). An approval
 *        for the OLD content — re-delivered with a FRESH `issuedAt`, so no
 *        notion of token consumption can explain the result — no longer clears
 *        the gate: `create_slice` refuses, names the approval, and persists NO
 *        new slice file.
 *     3. FRESH MINT — a new approval minted for the NEW content (same subject,
 *        same secret, same store) clears the very same call. This is the
 *        positive control that pins the step-2 refusal on the content hash
 *        alone.
 *
 * This test CONSUMES the approval-token contract (`mintApproval`,
 * `verifyApproval`, `approvalContentHash`,
 * `loadOrCreateApprovalSecret` from approvalToken.ts and `createApprovalStore`
 * from approvalStore.ts) to seed the store exactly the way the host's Approve
 * button does — it never re-derives hashing or signing, so a contract drift
 * surfaces here instead of silently passing.
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
  verifyApproval,
  approvalContentHash,
  loadOrCreateApprovalSecret,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";

// ── scaffolding (mirrors SP-6_3_AC-1.test.ts / createSliceDagGate.test.ts) ───

// The composite `<tep>/<spec>` id → the gate's kind-namespaced subject.
const SPEC = "1/1";
const SUBJECT_KEY = "spec:TEP-1/SP-1";

// Two spec bodies for the SAME spec: identical frontmatter and an identical
// Acceptance Criteria block (so every OTHER →Ready gate stays satisfied across
// the edit), differing only in Design prose — the kind of iteration
// `/spec-prepare` produces after the maintainer already clicked Approve.
const BODY_V1 =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n\n## Design\n\nFirst draft.\n";
const BODY_V2 =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n\n## Design\n\nRevised after review — the reviewed document is no longer what the human saw.\n";

const SPEC_FRONTMATTER = {
  implements: "TEP-x",
  ac_verifications: { "1": { run: "npm test" } },
};

/** A fresh thinking space seeded with a Spec (at BODY_V1) that clears every
 *  OTHER →Ready gate, so the only thing left to decide is the human-approval
 *  gate under test. */
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-approval-rearm-thinking space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(store.pathForSpecDoc(SPEC), SPEC_FRONTMATTER, BODY_V1);
  return store;
}

const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
});

const createSlice = (store: ThinkubeStore, title: string) =>
  dispatchTool(
    "create_slice",
    { spec: SPEC, title, body: "detail", files: ["src/foo.ts"] },
    ctxFor(store),
    () => {},
  );

/** Run `fn` with the gate resolving to a fresh temp approval dir. `create_slice` self-locates its
 *  store via `resolveApprovalDir(process.argv[1])` (SP-6/17), so we root `process.argv[1]` at an
 *  install-shaped path whose three-up walk lands on `approvalDir`, restoring argv afterwards. */
async function withArmedGate(
  fn: (approvalDir: string) => Promise<void>,
): Promise<void> {
  const approvalDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-approval-dir-"),
  );
  const prev = process.argv[1];
  process.argv[1] = path.join(
    approvalDir,
    "extension-current",
    "dist",
    "mcp",
    "kanbanMcpServer.js",
  );
  try {
    await fn(approvalDir);
  } finally {
    process.argv[1] = prev;
  }
}

/** Read the CURRENT spec body off the store — the exact document the gate hashes. */
async function currentSpecBody(store: ThinkubeStore): Promise<string> {
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the seeded spec doc must exist");
  return doc!.body;
}

/** Mint an approval over `body`'s content hash and deliver it through the
 *  side-channel store — exactly what the host's Approve button does. */
function approveContent(approvalDir: string, body: string, issuedAt: number) {
  const secret = loadOrCreateApprovalSecret(approvalDir);
  const token = mintApproval(
    SUBJECT_KEY,
    approvalContentHash(body),
    issuedAt,
    secret,
  );
  createApprovalStore(approvalDir).put(SUBJECT_KEY, token);
  return token;
}

// ── Token layer: the content hash is the only moving variable ────────────────

test("verifyApproval is content-bound: a token for hash(A) verifies against A, fails against B, and a fresh mint for B verifies against B", () => {
  const secretDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-approval-secret-"),
  );
  const secret = loadOrCreateApprovalSecret(secretDir);
  const now = 1_750_000_000_000; // fixed issuedAt — retained for audit, not a rejection axis

  const hashA = approvalContentHash(BODY_V1);
  const hashB = approvalContentHash(BODY_V2);
  // The premise of content-binding: distinct bodies → distinct hashes, and the
  // helper is deterministic (a re-mint for the same content matches the gate).
  assert.notEqual(hashA, hashB, "distinct spec bodies must hash differently");
  assert.equal(
    approvalContentHash(BODY_V1),
    hashA,
    "approvalContentHash must be deterministic — a mint for the current content matches what the gate recomputes",
  );

  const tokenForA = mintApproval(SUBJECT_KEY, hashA, now, secret);
  const base = { subjectKey: SUBJECT_KEY, secret };

  // Minted for content A → satisfies while the content IS A…
  assert.equal(
    verifyApproval(tokenForA, { ...base, contentHash: hashA }),
    true,
    "an approval minted for the current content must verify",
  );
  // …and stops verifying the instant the content hash moves — same subject,
  // same secret.
  assert.equal(
    verifyApproval(tokenForA, { ...base, contentHash: hashB }),
    false,
    "the same approval must NOT verify once the content hash differs",
  );
  // A fresh approval minted for the NEW content verifies for it.
  assert.equal(
    verifyApproval(mintApproval(SUBJECT_KEY, hashB, now, secret), {
      ...base,
      contentHash: hashB,
    }),
    true,
    "a fresh approval minted for the new content must verify",
  );
});

// ── Gate layer: satisfy → edit → refuse → re-approve → satisfy ───────────────

test("ARMED gate: an approval for the current content satisfies create_slice; editing the spec re-arms the gate until a fresh approval is minted for the new content", async () => {
  await withArmedGate(async (approvalDir) => {
    const store = await seededStore();

    // 1) SATISFIES — approve the spec as it stands (content V1), then create
    //    a slice: the approval minted for the current content clears the gate.
    approveContent(approvalDir, await currentSpecBody(store), Date.now());
    const first = (await createSlice(store, "sliced under V1 approval")) as {
      slice: string;
    };
    assert.match(
      first.slice,
      /^TEP-1_SP-1_SL-\d+$/,
      "an approval minted for the current spec content must satisfy the armed gate",
    );
    assert.equal(
      (await store.listSlices(SPEC)).length,
      1,
      "the approved create_slice must persist the slice file",
    );

    // 2) RE-ARMS — edit the spec (Design prose changes; frontmatter and the
    //    AC block are untouched, so every OTHER gate stays green). The content
    //    hash moves under the standing approval.
    await store.writeFile(
      store.pathForSpecDoc(SPEC),
      SPEC_FRONTMATTER,
      BODY_V2,
    );
    assert.notEqual(
      approvalContentHash(BODY_V2),
      approvalContentHash(BODY_V1),
      "the edit must actually move the content hash",
    );

    //    Re-deliver an approval for the OLD content with a FRESH issuedAt:
    //    it cannot have been "used up" (fresh put), so a refusal is
    //    attributable to the content hash ALONE.
    approveContent(approvalDir, BODY_V1, Date.now());

    await assert.rejects(
      () => createSlice(store, "sliced after edit, stale-content approval"),
      (err: unknown) => {
        const msg = (err as Error).message;
        // The refusal names the (now content-mismatched) approval…
        assert.match(
          msg,
          /approval/i,
          `the refusal must name the invalid approval (got: ${msg})`,
        );
        // …and directs the caller back to the Approve action (re-approve).
        assert.match(
          msg,
          /\bapprove\b/i,
          `the refusal must direct to the Approve action (got: ${msg})`,
        );
        return true;
      },
      "an approval minted for the OLD spec content must no longer clear the gate once the content changed",
    );

    //    The refusal is total: no new slice file appeared.
    assert.equal(
      (await store.listSlices(SPEC)).length,
      1,
      "a create_slice refused for a content-mismatched approval must not persist a slice file",
    );

    // 3) FRESH MINT — approve the CURRENT (edited) content; the very same call
    //    now clears the gate, pinning the step-2 refusal on the content hash.
    approveContent(approvalDir, await currentSpecBody(store), Date.now());
    const second = (await createSlice(store, "sliced under V2 approval")) as {
      slice: string;
    };
    assert.match(
      second.slice,
      /^TEP-1_SP-1_SL-\d+$/,
      "a fresh approval minted for the new content must satisfy the gate again",
    );
    assert.equal(
      (await store.listSlices(SPEC)).length,
      2,
      "the re-approved create_slice must persist the new slice file",
    );
  });
});
