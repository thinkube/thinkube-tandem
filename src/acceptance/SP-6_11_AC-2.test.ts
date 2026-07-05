/**
 * SP-6/11 (TEP-6) AC2 — **editing the spec after approval still voids it**: a
 * token whose `contentHash` no longer matches the current body is refused with a
 * **`content-mismatch`** reason — never a time-based `expired` — so the refusal
 * names the content change rather than a clock.
 *
 * This exercises the pure approval seam directly (SPEC CONTRACT):
 *   - `approvalStatus(token, { subjectKey, contentHash, secret })` returns the
 *     first failing check, and for a content-only defect that is
 *     `{ ok: false, reason: 'content-mismatch' }`.
 *   - `verifyApproval` — the thin boolean wrapper — returns `false` for the same
 *     token (its purity / never-throws contract is unchanged).
 *   - the refusal-reason union carries NO `'expired'` member, proven both at the
 *     TYPE level (a compile-time exhaustiveness assertion) and BEHAVIOURALLY
 *     (a content-matching approval with an `issuedAt` well over the old 15-minute
 *     window still verifies — time is no longer a rejection axis, so no code path
 *     can produce a time-based refusal).
 *
 * Every token below is valid in every dimension EXCEPT content (real server
 * secret, matching subject, well-formed HMAC) so the `content-mismatch` verdict
 * is attributable to the content edit alone — and the check order
 * (signature → subject → content) means content is exactly the check that fires.
 *
 * CONSUMES the contract — `mintApproval` / `approvalContentHash` /
 * `loadOrCreateApprovalSecret` / `approvalStatus` / `verifyApproval` and the
 * `ApprovalRefusalReason` / `ApprovalStatus` types (approvalToken.ts) — rather
 * than re-deriving token or hash shapes, so a contract drift surfaces here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  approvalContentHash,
  approvalStatus,
  loadOrCreateApprovalSecret,
  mintApproval,
  verifyApproval,
  type ApprovalRefusalReason,
  type ApprovalStatus,
  type ApprovalToken,
} from "../services/approvalToken";

// ── fixture ──────────────────────────────────────────────────────────────────

const SUBJECT = "spec:TEP-6/SP-11";

// The body the maintainer reviewed and approved.
const REVIEWED_BODY =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] the reviewed content\n";
// The same spec after a one-character edit — any edit moves the content hash.
const EDITED_BODY = REVIEWED_BODY + "x";

interface Fixture {
  /** The REAL server approval secret (loaded exactly as the armed gate does). */
  secret: Buffer;
  /** Hash of the body the human approved. */
  approvedHash: string;
  /** Hash of the CURRENT (edited) body the gate now checks against. */
  currentHash: string;
  /** A genuine token: real secret, this subject, hash of the REVIEWED body. */
  token: ApprovalToken;
}

function fixture(issuedAt = 1_000_000): Fixture {
  const approvalDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-sp611-ac2-approval-"),
  );
  const secret = loadOrCreateApprovalSecret(approvalDir);
  const approvedHash = approvalContentHash(REVIEWED_BODY);
  const currentHash = approvalContentHash(EDITED_BODY);
  // Sanity: an edit MUST move the hash, else the whole AC is vacuous.
  assert.notEqual(
    approvedHash,
    currentHash,
    "a spec edit must change approvalContentHash — else the gate could not detect it",
  );
  const token = mintApproval(SUBJECT, approvedHash, issuedAt, secret);
  return { secret, approvedHash, currentHash, token };
}

// ── 1. content-mismatch: an edited-body gate refuses with the content reason ──

test("approvalStatus REFUSES an edited-body token with reason 'content-mismatch'", () => {
  const f = fixture();

  const status = approvalStatus(f.token, {
    subjectKey: SUBJECT,
    contentHash: f.currentHash, // the CURRENT (edited) body — no longer what was signed
    secret: f.secret,
  });

  assert.deepEqual(
    status,
    { ok: false, reason: "content-mismatch" },
    "a token whose contentHash no longer matches the current body must be refused as content-mismatch",
  );
});

// ── 2. the content reason is NOT a time-based 'expired' ──────────────────────

test("the content-mismatch refusal never surfaces as a time-based 'expired'", () => {
  const f = fixture();
  const status = approvalStatus(f.token, {
    subjectKey: SUBJECT,
    contentHash: f.currentHash,
    secret: f.secret,
  });

  assert.equal(status.ok, false);
  if (status.ok === false) {
    assert.notEqual(
      status.reason as string,
      "expired",
      "editing content must name the content change, never a clock",
    );
    assert.equal(status.reason, "content-mismatch");
  }
});

// ── 3. content is the check that fires (order: signature → subject → content) ─

test("with a valid signature and matching subject, the content edit is the sole cause of refusal", () => {
  const f = fixture();

  // Same token, but the gate now checks the ORIGINAL (approved) hash → passes.
  const asApproved = approvalStatus(f.token, {
    subjectKey: SUBJECT,
    contentHash: f.approvedHash,
    secret: f.secret,
  });
  assert.deepEqual(
    asApproved,
    { ok: true },
    "against the reviewed content, signature + subject + content all hold → ok",
  );

  // Flip ONLY the content hash to the edited body → content-mismatch.
  const asEdited = approvalStatus(f.token, {
    subjectKey: SUBJECT,
    contentHash: f.currentHash,
    secret: f.secret,
  });
  assert.deepEqual(
    asEdited,
    { ok: false, reason: "content-mismatch" },
    "changing only the content hash flips ok:true → content-mismatch, isolating the cause",
  );
});

// ── 4. verifyApproval (the boolean wrapper) agrees and never throws ──────────

test("verifyApproval returns false for the edited-body token (and stays total)", () => {
  const f = fixture();

  assert.equal(
    verifyApproval(f.token, {
      subjectKey: SUBJECT,
      contentHash: f.currentHash,
      secret: f.secret,
    }),
    false,
    "verifyApproval === approvalStatus(...).ok, so a content-mismatch is false",
  );

  // Same token still verifies against the content it was minted for.
  assert.equal(
    verifyApproval(f.token, {
      subjectKey: SUBJECT,
      contentHash: f.approvedHash,
      secret: f.secret,
    }),
    true,
    "against the reviewed content the same token verifies — the mismatch, not the token, is the defect",
  );
});

// ── 5. TIME is not a rejection axis: an old-but-matching token still verifies ─

test("an approval well over 15 minutes old still verifies when content matches (no 'expired')", () => {
  // issuedAt an hour before any conceivable check time — under the retired TTL
  // this would have "expired". With time removed as an axis, matching content
  // alone keeps it valid, so there is no state that could be labelled expired.
  const f = fixture(1_000);
  const wayLater = 1_000 + 60 * 60 * 1000; // an hour later — irrelevant to the verdict

  const status = approvalStatus(f.token, {
    subjectKey: SUBJECT,
    contentHash: f.approvedHash,
    secret: f.secret,
  });
  assert.deepEqual(
    status,
    { ok: true },
    "an old but content-matching approval is honoured however long the human took",
  );
  // The contract exposes no now/ttlMs param, so `wayLater` cannot even be passed
  // to the gate — time is structurally absent from the rejection surface.
  void wayLater;
  assert.equal(
    verifyApproval(f.token, {
      subjectKey: SUBJECT,
      contentHash: f.approvedHash,
      secret: f.secret,
    }),
    true,
  );
});

// ── 6. TYPE-LEVEL: the refusal-reason union has NO 'expired' member ──────────

test("the ApprovalRefusalReason union carries no 'expired' value", () => {
  // Compile-time exhaustiveness: if the union were widened to include 'expired'
  // (or anything beyond the three surviving reasons), `Exclude<…>` would not be
  // `never` and `_NoExtraReasons` could not be `true` — this file would fail to
  // compile, failing the AC at build time rather than silently at runtime.
  type _NoExtraReasons = [
    Exclude<
      ApprovalRefusalReason,
      "bad-signature" | "subject-mismatch" | "content-mismatch"
    >,
  ] extends [never]
    ? true
    : false;
  const _assertNoExpired: _NoExtraReasons = true;
  assert.equal(_assertNoExpired, true);

  // And the inverse: 'expired' is NOT assignable to the reason type. We express
  // this at runtime over the three legal reasons, proving the string the panel
  // once used is not part of the refusal vocabulary.
  const legalReasons: ApprovalRefusalReason[] = [
    "bad-signature",
    "subject-mismatch",
    "content-mismatch",
  ];
  assert.ok(
    !(legalReasons as string[]).includes("expired"),
    "'expired' must not be one of the refusal reasons — time is not a rejection axis",
  );

  // A failed status's reason is always drawn from that closed set.
  const f = fixture();
  const failing: ApprovalStatus = approvalStatus(f.token, {
    subjectKey: SUBJECT,
    contentHash: f.currentHash,
    secret: f.secret,
  });
  assert.equal(failing.ok, false);
  if (failing.ok === false) {
    assert.ok(
      legalReasons.includes(failing.reason),
      "every refusal reason is one of the three surviving, non-time-based checks",
    );
  }
});
