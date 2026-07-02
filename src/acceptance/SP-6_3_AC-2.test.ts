/**
 * SP-6/3 (TEP-6) AC2 — **a forged, expired, or wrong-subject approval is rejected**,
 * driven through the real `create_slice` TOOL CALL (`dispatchTool`, the layer the
 * live MCP server runs), with the approval gate ARMED via `THINKUBE_APPROVAL_DIR`
 * (read per call — no import-time caching — so setting it inside a test takes
 * effect on that test's calls).
 *
 * What this proves, per defect (each token is valid in EVERY dimension except the
 * one under test, so the refusal is attributable to that defect alone):
 *
 *   1. FORGED       — a token HMAC'd under a secret that is NOT the server's
 *                     approval secret (an agent emitting its own token) does not
 *                     satisfy the gate.
 *   2. EXPIRED      — a token minted with the real server secret but with
 *                     `issuedAt` past `APPROVAL_TTL_MS` does not satisfy the gate.
 *   3. WRONG SUBJECT (another spec) — a token minted for `spec:TEP-1/SP-2` never
 *                     satisfies `spec:TEP-1/SP-1`'s gate, even when smuggled into
 *                     the store under the gate's own subjectKey.
 *   4. WRONG SUBJECT (`tep:` namespace) — a token minted for `tep:TEP-1` never
 *                     satisfies a `spec:`-namespaced gate; the kind-namespaced
 *                     subjectKey keeps the two approval moments disjoint.
 *
 * Every refusal is TOTAL (no slice file is created) and its error names the
 * missing/invalid approval, directing to the Approve action. Each test then
 * repairs ONLY the defect (right secret / fresh issuedAt / right subject) and
 * shows `create_slice` clears the gate — proving the tested defect, and nothing
 * in the scaffolding, caused the refusal.
 *
 * This CONSUMES the approval contract — `mintApproval` / `APPROVAL_TTL_MS` /
 * `loadOrCreateApprovalSecret` / `approvalContentHash` (approvalToken.ts) and
 * `createApprovalStore` (approvalStore.ts) — rather than re-deriving token or
 * hash shapes, so a contract drift surfaces here instead of silently passing.
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
  APPROVAL_TTL_MS,
  approvalContentHash,
  loadOrCreateApprovalSecret,
  mintApproval,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";

// ── fixture ──────────────────────────────────────────────────────────────────

// The composite spec id `<tep>/<spec>` and the kind-namespaced subjectKey the
// gate derives from it (`spec:TEP-<tep>/SP-<sp>`).
const SPEC = "1/1";
const SUBJECT = "spec:TEP-1/SP-1";
// Sibling / foreign subjects for the wrong-subject branches.
const OTHER_SPEC_SUBJECT = "spec:TEP-1/SP-2";
const TEP_SUBJECT = "tep:TEP-1";

// A seeded spec that clears every OTHER create_slice gate (structural readyGate:
// one AC + a certified, runnable `ac_verifications` entry — mirrors
// createSliceDagGate.test.ts), so the approval gate is the only thing deciding.
async function seededStore(): Promise<ThinkubeStore> {
  const thinkingSpace = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-ac2-thinking space-"),
  );
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc(SPEC),
    { implements: "TEP-1", ac_verifications: { "1": { run: "npm test" } } },
    "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n",
  );
  return store;
}

interface Fixture {
  store: ThinkubeStore;
  approvalDir: string;
  /** The REAL server approval secret — the one the armed gate loads from approvalDir. */
  secret: Buffer;
  /** THE hash the gate applies to the current spec body (contract: approvalContentHash). */
  contentHash: string;
}

async function fixture(): Promise<Fixture> {
  const store = await seededStore();
  const approvalDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-ac2-approval-"),
  );
  // Loading here is exactly what the server does per call — same dir, same key
  // file — so tokens minted with `secret` are "genuinely approved" tokens, and
  // any OTHER secret stands in for a forger's key.
  const secret = loadOrCreateApprovalSecret(approvalDir);
  const doc = await store.getFile(store.pathForSpecDoc(SPEC));
  assert.ok(doc, "the seeded spec doc must exist");
  const contentHash = approvalContentHash(doc!.body);
  return { store, approvalDir, secret, contentHash };
}

// Minimal HandlerContext (mirrors the sibling dispatch tests): create_slice
// touches thinkingSpaces.resolve; promoteLocator is a harmless superset.
const ctxFor = (store: ThinkubeStore) => ({
  env: {} as never,
  thinkingSpaces: { resolve: () => store } as never,
  promoteLocator: (() => undefined) as never,
});

const createSlice = (store: ThinkubeStore, title: string) =>
  dispatchTool(
    "create_slice",
    { spec: SPEC, title, body: "detail", files: ["src/foo.ts"] },
    ctxFor(store),
    () => {},
  );

/** Run `fn` with the approval gate ARMED (THINKUBE_APPROVAL_DIR set), restoring
 *  the environment afterwards — the env var is read per call, so this scopes the
 *  arming to exactly the calls inside `fn`. */
async function withArmedGate<T>(
  approvalDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = process.env.THINKUBE_APPROVAL_DIR;
  process.env.THINKUBE_APPROVAL_DIR = approvalDir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.THINKUBE_APPROVAL_DIR;
    else process.env.THINKUBE_APPROVAL_DIR = prev;
  }
}

/** Assert `create_slice` is REFUSED — the error names the approval / Approve
 *  action — and that the refusal is total (no slice file was created). */
async function assertRefusedTotally(
  store: ThinkubeStore,
  attempt: () => Promise<unknown>,
  why: string,
): Promise<void> {
  await assert.rejects(attempt, (err: unknown) => {
    const msg = (err as Error).message;
    assert.match(
      msg,
      /approv/i,
      `${why}: the refusal must name the missing/invalid approval and direct to the Approve action (got: ${msg})`,
    );
    return true;
  });
  assert.deepEqual(
    await store.listSlices(SPEC),
    [],
    `${why}: the refusal must be total — no slice file may be created`,
  );
}

/** After a refusal, deliver a token whose ONLY difference is the repaired defect
 *  and assert the gate now clears — attributing the refusal to that defect. */
async function assertRepairUnblocks(f: Fixture, title: string): Promise<void> {
  const goodToken = mintApproval(SUBJECT, f.contentHash, Date.now(), f.secret);
  createApprovalStore(f.approvalDir).put(SUBJECT, goodToken);
  const res = (await createSlice(f.store, title)) as { slice: string };
  assert.match(
    res.slice,
    /^TEP-1_SP-1_SL-\d+$/,
    "with only the defect repaired, the valid approval must clear the gate",
  );
  assert.equal(
    (await f.store.listSlices(SPEC)).length,
    1,
    "exactly the repaired attempt's slice must exist",
  );
}

// ── sanity: the TTL constant the expired fixture leans on is a real duration ──

test("APPROVAL_TTL_MS is a positive finite duration (the expiry branch is meaningful)", () => {
  assert.equal(typeof APPROVAL_TTL_MS, "number");
  assert.ok(Number.isFinite(APPROVAL_TTL_MS), "APPROVAL_TTL_MS must be finite");
  assert.ok(APPROVAL_TTL_MS > 0, "APPROVAL_TTL_MS must be > 0");
});

// ── 1. FORGED: a token signed under a non-server secret is rejected ──────────

test("create_slice REFUSES a forged approval (HMAC under a secret that is not the server's)", async () => {
  const f = await fixture();
  await withArmedGate(f.approvalDir, async () => {
    // The forger holds SOME key — just not the server's. Subject, content hash,
    // and freshness are all correct: the signature is the only defect.
    const forgerSecret = Buffer.alloc(32, 0x5a);
    assert.notDeepEqual(forgerSecret, f.secret);
    const forged = mintApproval(
      SUBJECT,
      f.contentHash,
      Date.now(),
      forgerSecret,
    );
    createApprovalStore(f.approvalDir).put(SUBJECT, forged);

    await assertRefusedTotally(
      f.store,
      () => createSlice(f.store, "forged approval"),
      "forged token",
    );

    // Repair ONLY the signature (mint under the real server secret) → clears.
    await assertRepairUnblocks(f, "genuinely approved");
  });
});

// ── 2. EXPIRED: a genuinely-signed token past its TTL is rejected ────────────

test("create_slice REFUSES an expired approval (real secret, issuedAt past APPROVAL_TTL_MS)", async () => {
  const f = await fixture();
  await withArmedGate(f.approvalDir, async () => {
    // Signed with the REAL server secret, correct subject and content hash —
    // but issued a full hour beyond the TTL, so age is the only defect.
    const staleIssuedAt = Date.now() - APPROVAL_TTL_MS - 60 * 60 * 1000;
    const expired = mintApproval(
      SUBJECT,
      f.contentHash,
      staleIssuedAt,
      f.secret,
    );
    createApprovalStore(f.approvalDir).put(SUBJECT, expired);

    await assertRefusedTotally(
      f.store,
      () => createSlice(f.store, "expired approval"),
      "expired token",
    );

    // Repair ONLY the freshness (re-mint now) → clears.
    await assertRepairUnblocks(f, "freshly approved");
  });
});

// ── 3. WRONG SUBJECT (another spec): subjectKey binding is enforced ──────────

test("create_slice REFUSES an approval minted for ANOTHER spec's subjectKey", async () => {
  const f = await fixture();
  await withArmedGate(f.approvalDir, async () => {
    // A perfectly genuine approval — real secret, fresh, this spec's content
    // hash — but minted for a SIBLING spec's subject. Delivered both under its
    // own key (where this gate never looks) AND smuggled under THIS gate's key
    // (a replay): neither placement may satisfy spec:TEP-1/SP-1.
    const foreign = mintApproval(
      OTHER_SPEC_SUBJECT,
      f.contentHash,
      Date.now(),
      f.secret,
    );
    const store = createApprovalStore(f.approvalDir);
    store.put(OTHER_SPEC_SUBJECT, foreign);
    store.put(SUBJECT, foreign); // the smuggle/replay

    await assertRefusedTotally(
      f.store,
      () => createSlice(f.store, "other spec's approval"),
      "wrong-subject (another spec) token",
    );

    // Repair ONLY the subject (mint for THIS spec) → clears.
    await assertRepairUnblocks(f, "approved for this spec");
  });
});

// ── 4. WRONG SUBJECT (tep: namespace): kind-namespacing keeps gates disjoint ─

test("create_slice REFUSES an approval minted for a tep:-namespaced subject", async () => {
  const f = await fixture();
  await withArmedGate(f.approvalDir, async () => {
    // A genuine "Accept TEP"-shaped token (the follow-up instance's subject
    // kind) — real secret, fresh, same content hash — must never satisfy a
    // spec:-namespaced gate, even smuggled under the gate's own key.
    const tepToken = mintApproval(
      TEP_SUBJECT,
      f.contentHash,
      Date.now(),
      f.secret,
    );
    const store = createApprovalStore(f.approvalDir);
    store.put(TEP_SUBJECT, tepToken);
    store.put(SUBJECT, tepToken); // the smuggle/replay

    await assertRefusedTotally(
      f.store,
      () => createSlice(f.store, "tep-subject approval"),
      "wrong-subject (tep:) token",
    );

    // Repair ONLY the subject kind (mint for spec:TEP-1/SP-1) → clears.
    await assertRepairUnblocks(f, "approved under the spec: subject");
  });
});
