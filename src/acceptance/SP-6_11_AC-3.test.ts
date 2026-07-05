/**
 * SP-6/11 (TEP-6) AC3 — Subject binding is preserved.
 *
 * "An approval minted for one `subjectKey` never satisfies a different subject's
 *  gate."
 *
 * SP-6/11 removes the TTL as a rejection axis but must NOT weaken SP-6/3's other
 * three bindings. This unit pins the subject binding under the NEW contract:
 *
 *   - `approvalStatus(token, { subjectKey, contentHash, secret })` — pure, total,
 *     runs signature -> subject -> content IN ORDER and returns the first failure.
 *   - `verifyApproval(token, { subjectKey, contentHash, secret })` — the boolean
 *     wrapper = `approvalStatus(...).ok` (no `now` / `ttlMs` params anymore).
 *
 * Every case here holds the secret and the content hash CONSTANT and moves ONLY
 * the subjectKey, so:
 *   - the signature check passes (right secret, untampered token),
 *   - the content check would pass (matching hash),
 *   - therefore the sole reason a cross-subject token can be refused is the
 *     subject check — and the reason is EXACTLY `'subject-mismatch'`, never
 *     `'bad-signature'` or `'content-mismatch'`.
 *
 * This is what proves the refusal is the subject binding doing its job (not a
 * signature or content accident): an approval for `spec:TEP-6/SP-9` cannot be
 * ridden to clear the gate for `spec:TEP-6/SP-3` or for `tep:TEP-6`, and vice
 * versa — the kind namespace and the id both matter.
 *
 * Exercised strictly through the SPEC CONTRACT's public interface from
 * src/services/approvalToken.ts: `approvalStatus`, `verifyApproval`,
 * `mintApproval`, `approvalContentHash`, `loadOrCreateApprovalSecret`, and the
 * `ApprovalToken` / `ApprovalStatus` / `ApprovalRefusalReason` types. It never
 * re-derives hashing or signing, so a contract drift surfaces here.
 *
 * Time is deliberately absent: no `now`, no `ttlMs`, no `APPROVAL_TTL_MS`. The
 * subject binding is orthogonal to the retired clock, and this unit must keep
 * verifying regardless of how much wall-clock has elapsed.
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
  type ApprovalToken,
  type ApprovalStatus,
  type ApprovalRefusalReason,
} from "../services/approvalToken";

// ── fixtures ──────────────────────────────────────────────────────────────────

function tmpDir(prefix = "tk-approval-sp11-ac3-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Kind-namespaced subjects for distinct specs — the gate's subjectKeys. */
const SUBJECT_A = "spec:TEP-6/SP-9";
const SUBJECT_B = "spec:TEP-6/SP-3";
/** Same id, DIFFERENT kind — a `tep:` approval must not clear a `spec:` gate. */
const SUBJECT_TEP = "tep:TEP-6";

/** One representative reviewed body, hashed by THE exported helper — the same
 *  function the gate applies — so content is identical across every subject and
 *  can never be the reason a cross-subject token is refused. */
const SPEC_BODY = [
  "# A subject-bound approval",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] An approval for one subject never satisfies another subject's gate.",
  "",
].join("\n");
const CONTENT_HASH = approvalContentHash(SPEC_BODY);

/** A deterministic issuedAt. Under SP-6/11 time is not a rejection axis, so the
 *  exact value is immaterial to the verdict — it only rides in the payload. */
const ISSUED_AT = 1_750_000_000_000;

/** Verify-args for a given subject, with secret + content held constant so the
 *  ONLY moving variable across cases is the subjectKey. */
const argsFor = (subjectKey: string, secret: Buffer) => ({
  subjectKey,
  contentHash: CONTENT_HASH,
  secret,
});

// ── 1. positive control: the token satisfies ITS OWN subject ──────────────────

test("an approval verifies for the subject it was minted for (positive control)", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT_A, CONTENT_HASH, ISSUED_AT, secret);

  const status = approvalStatus(token, argsFor(SUBJECT_A, secret));
  assert.deepEqual(
    status,
    { ok: true },
    "a token minted for a subject must satisfy that same subject's gate " +
      "(matching secret + content) — without this control the negatives below " +
      "could be an always-refusing verifier",
  );
  assert.equal(
    verifyApproval(token, argsFor(SUBJECT_A, secret)),
    true,
    "the boolean wrapper agrees with approvalStatus(...).ok on the match",
  );
});

// ── 2. the core AC: a token for subject A never clears subject B's gate ────────

test("an approval minted for one subjectKey does NOT satisfy a different subject's gate — reason: subject-mismatch", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const tokenForA = mintApproval(SUBJECT_A, CONTENT_HASH, ISSUED_AT, secret);

  assert.notEqual(
    SUBJECT_A,
    SUBJECT_B,
    "precondition: the two subjects are genuinely distinct",
  );

  const status = approvalStatus(tokenForA, argsFor(SUBJECT_B, secret));
  assert.equal(
    status.ok,
    false,
    "a token for subject A must not satisfy subject B's gate",
  );
  assert.equal(
    (status as { ok: false; reason: ApprovalRefusalReason }).reason,
    "subject-mismatch",
    "the refusal must name the SUBJECT binding — signature (right secret) and " +
      "content (matching hash) both pass, so subject is the only check that fails",
  );
  assert.equal(
    verifyApproval(tokenForA, argsFor(SUBJECT_B, secret)),
    false,
    "the boolean wrapper reflects the same refusal",
  );
});

// ── 3. the binding is symmetric — B's token cannot ride A's gate either ────────

test("subject binding is symmetric: a token for subject B does not satisfy subject A's gate", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const tokenForB = mintApproval(SUBJECT_B, CONTENT_HASH, ISSUED_AT, secret);

  // Its own subject: satisfied.
  assert.deepEqual(
    approvalStatus(tokenForB, argsFor(SUBJECT_B, secret)),
    { ok: true },
    "sanity: the B-token clears the B-gate",
  );
  // The other subject: subject-mismatch, not content/signature.
  const status = approvalStatus(tokenForB, argsFor(SUBJECT_A, secret));
  assert.deepEqual(
    status,
    { ok: false, reason: "subject-mismatch" },
    "the B-token must be refused for the A-gate on subject grounds alone",
  );
});

// ── 4. the kind namespace matters: tep:… vs spec:… never cross ────────────────

test("kind-namespaced subjects do not cross: a `tep:` approval never satisfies a `spec:` gate (and vice versa)", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());

  const tepToken = mintApproval(SUBJECT_TEP, CONTENT_HASH, ISSUED_AT, secret);
  const specToken = mintApproval(SUBJECT_B, CONTENT_HASH, ISSUED_AT, secret);

  // A tep approval offered to a spec gate — refused on subject.
  assert.deepEqual(
    approvalStatus(tepToken, argsFor(SUBJECT_B, secret)),
    { ok: false, reason: "subject-mismatch" },
    "an approval for `tep:TEP-6` must not clear the `spec:TEP-6/SP-3` gate",
  );
  // A spec approval offered to a tep gate — refused on subject.
  assert.deepEqual(
    approvalStatus(specToken, argsFor(SUBJECT_TEP, secret)),
    { ok: false, reason: "subject-mismatch" },
    "an approval for `spec:TEP-6/SP-3` must not clear the `tep:TEP-6` gate",
  );
  // Each still clears its own subject — the refusals above are the namespace,
  // not a broken verifier.
  assert.equal(verifyApproval(tepToken, argsFor(SUBJECT_TEP, secret)), true);
  assert.equal(verifyApproval(specToken, argsFor(SUBJECT_B, secret)), true);
});

// ── 5. one approval, many foreign gates — none clear, all name the subject ─────

test("a single approval is refused for every foreign subject with subject-mismatch, and total for none of them", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const tokenForA = mintApproval(SUBJECT_A, CONTENT_HASH, ISSUED_AT, secret);

  for (const foreign of [
    SUBJECT_B,
    SUBJECT_TEP,
    "spec:TEP-6/SP-11",
    "spec:TEP-7/SP-9", // same numeric shape, different tep — must not collide
    "skill:TEP-6/SP-9", // same id, different kind
    "spec:TEP-6/SP-9 ", // a trailing space is a DIFFERENT subject
  ]) {
    const status: ApprovalStatus = approvalStatus(
      tokenForA,
      argsFor(foreign, secret),
    );
    assert.deepEqual(
      status,
      { ok: false, reason: "subject-mismatch" },
      `an approval for ${SUBJECT_A} must be refused for foreign subject ${JSON.stringify(
        foreign,
      )} on subject grounds`,
    );
    assert.equal(
      verifyApproval(tokenForA, argsFor(foreign, secret)),
      false,
      `the boolean wrapper also refuses foreign subject ${JSON.stringify(
        foreign,
      )}`,
    );
  }

  // And it still clears its own subject — the loop above was the subject binding
  // at work, not a verifier that refuses everything.
  assert.deepEqual(
    approvalStatus(tokenForA, argsFor(SUBJECT_A, secret)),
    { ok: true },
    "the same approval still satisfies its own subject's gate",
  );
});

// ── 6. purity: cross-subject verification never throws ────────────────────────

test("approvalStatus / verifyApproval are pure and never throw on a cross-subject token", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const tokenForA: ApprovalToken = mintApproval(
    SUBJECT_A,
    CONTENT_HASH,
    ISSUED_AT,
    secret,
  );

  let status: ApprovalStatus | undefined;
  let bool: boolean | undefined;
  assert.doesNotThrow(() => {
    status = approvalStatus(tokenForA, argsFor(SUBJECT_B, secret));
    bool = verifyApproval(tokenForA, argsFor(SUBJECT_B, secret));
  }, "a subject mismatch is a refusal, never an exception");
  assert.equal(status?.ok, false);
  assert.equal(bool, false);
  // The boolean wrapper is exactly approvalStatus(...).ok.
  assert.equal(
    bool,
    approvalStatus(tokenForA, argsFor(SUBJECT_B, secret)).ok,
    "verifyApproval(...) === approvalStatus(...).ok",
  );
});
