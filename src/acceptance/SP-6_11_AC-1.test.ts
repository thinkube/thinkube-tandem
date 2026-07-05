/**
 * SP-6/11 (TEP-6) AC1 — The approval gate keys on spec CONTENT, not a short clock.
 *
 * "An approval token for an unchanged spec still satisfies the gate after the old
 *  15-minute window has elapsed: a token whose `issuedAt` is well over 15 minutes
 *  in the past verifies as valid given a matching subject and content hash."
 *
 * This is the crux of SP-6/11: the previous freshness check (`now - issuedAt >
 * ttlMs → reject`) is REMOVED as a rejection criterion. Slicing is a human-paced
 * step — a maintainer can Approve, step away, and slice later with the spec
 * unchanged — and the content hash (not a wall clock) is what certifies "this is
 * the approved artifact." So a content- and subject-matching approval must verify
 * however long ago it was issued.
 *
 * Proven purely at the token layer against the SP-6/11 SPEC CONTRACT:
 *   - `approvalStatus(token, { subjectKey, contentHash, secret })` — pure, total,
 *     no `now`/`ttlMs` (time is not a rejection axis) — returns `{ ok: true }` for
 *     an approval whose `issuedAt` sits FAR outside the old 15-minute window, so
 *     long as subject + content + signature all match.
 *   - `verifyApproval(token, { subjectKey, contentHash, secret })` — the
 *     back-compat boolean wrapper (`= approvalStatus(...).ok`) — likewise returns
 *     `true`, with the SAME argument shape (no `now`/`ttlMs`).
 *
 * The test CONSUMES the approval-token contract (`mintApproval`,
 * `approvalContentHash`, `loadOrCreateApprovalSecret`, plus the new
 * `approvalStatus` / narrowed `verifyApproval`) — it never re-derives hashing or
 * signing, so any contract drift surfaces here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  approvalStatus,
  verifyApproval,
  mintApproval,
  approvalContentHash,
  loadOrCreateApprovalSecret,
} from "../services/approvalToken";

// The gate's kind-namespaced subject (mirrors the SP-6/3 acceptance tests).
const SUBJECT_KEY = "spec:TEP-1/SP-1";

// The reviewed spec body — hashed once and kept UNCHANGED for the whole test, so
// the only thing that could conceivably move is the (now-irrelevant) clock.
const SPEC_BODY =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n\n## Design\n\nApproved, then sliced much later.\n";

/** A throwaway server-secret directory + its loaded secret. */
function freshSecret(): Buffer {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-approval-sp11-secret-"),
  );
  return loadOrCreateApprovalSecret(dir);
}

// The old TTL window this spec retires: 15 minutes. We mint an approval issued
// FAR outside it — hours in the past — to prove elapsed time alone no longer
// refuses a content-matching approval.
const OLD_TTL_MS = 15 * 60 * 1000;

test("SP-6/11 AC1 — an approval issued well over 15 minutes ago still verifies for unchanged content (approvalStatus → { ok: true })", () => {
  const secret = freshSecret();
  const contentHash = approvalContentHash(SPEC_BODY);

  // issuedAt = a fixed epoch-ms far enough in the past that, under ANY plausible
  // "now", the elapsed age dwarfs the retired 15-minute window (here ~5 hours,
  // and also strictly before Date.now() - OLD_TTL_MS regardless of wall clock).
  const issuedAt = Date.now() - 5 * 60 * 60 * 1000;
  assert.ok(
    Date.now() - issuedAt > OLD_TTL_MS,
    "precondition: the token is well past the old 15-minute TTL window",
  );

  const token = mintApproval(SUBJECT_KEY, contentHash, issuedAt, secret);

  // The gate — with a matching subject and the CURRENT content hash — accepts it.
  // No `now`/`ttlMs` is passed (nor accepted): time is not a rejection axis.
  const status = approvalStatus(token, {
    subjectKey: SUBJECT_KEY,
    contentHash,
    secret,
  });
  assert.deepEqual(
    status,
    { ok: true },
    "a content- and subject-matching approval must verify no matter how long ago it was issued",
  );
});

test("SP-6/11 AC1 — the boolean wrapper agrees: verifyApproval is true for the same old-but-unchanged approval", () => {
  const secret = freshSecret();
  const contentHash = approvalContentHash(SPEC_BODY);

  // A different, even older vintage (a full day ago) to underline that the age
  // magnitude is irrelevant now.
  const issuedAt = Date.now() - 24 * 60 * 60 * 1000;
  assert.ok(
    Date.now() - issuedAt > OLD_TTL_MS,
    "precondition: the token is well past the old 15-minute TTL window",
  );

  const token = mintApproval(SUBJECT_KEY, contentHash, issuedAt, secret);

  // The back-compat boolean wrapper — same argument shape (no now/ttlMs) — must
  // stay true, i.e. it is exactly `approvalStatus(...).ok`.
  assert.equal(
    verifyApproval(token, { subjectKey: SUBJECT_KEY, contentHash, secret }),
    true,
    "verifyApproval must honor an old-but-content-matching approval (= approvalStatus(...).ok)",
  );
});
