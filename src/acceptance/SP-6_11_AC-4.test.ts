/**
 * SP-6/11 (TEP-6) AC4 — Signature binding is preserved.
 *
 * "A token whose HMAC does not verify under the server approval secret is refused."
 *
 * SP-6/11 retires only the time-based expiry; the HMAC guarantee from SP-6/3 is
 * carried through UNCHANGED. Forgery is what stops the agent from synthesizing the
 * human's "go", so a token that does not authenticate under the server-only secret
 * must never satisfy the gate — regardless of how well its (untrusted) subject and
 * content bindings appear to match.
 *
 * Proven purely at the token layer against the SP-6/11 SPEC CONTRACT:
 *   - `approvalStatus(token, { subjectKey, contentHash, secret })` — pure, total,
 *     no `now`/`ttlMs` — returns `{ ok: false, reason: 'bad-signature' }` for a
 *     token whose HMAC does not verify under `secret`, whether the token was:
 *       (a) minted under a DIFFERENT secret,
 *       (b) tampered (MAC bytes flipped) after a valid mint,
 *       (c) structurally garbage, or
 *       (d) absent (`undefined`).
 *     Signature is the FIRST surviving check, so a wrong-secret token with an
 *     OTHERWISE-matching subject + content still fails with `bad-signature`, never
 *     `subject-mismatch` / `content-mismatch`.
 *   - `verifyApproval(token, { subjectKey, contentHash, secret })` — the
 *     back-compat boolean wrapper (`= approvalStatus(...).ok`) — returns `false`
 *     for every one of those, and never throws.
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

// The reviewed spec body — the content the (honest) approval would cover.
const SPEC_BODY =
  "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n\n## Design\n\nSigned by the host, forged by nobody.\n";

/** A throwaway server-secret directory + its loaded secret. Each call yields an
 *  INDEPENDENT secret dir, so two calls produce two unrelated HMAC keys. */
function freshSecret(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-approval-sp11-sig-"));
  return loadOrCreateApprovalSecret(dir);
}

// A fixed injectable issuedAt — time is not a rejection axis in SP-6/11, so its
// value is irrelevant to signature checking; we just need SOME epoch-ms to mint.
const ISSUED_AT = 1_750_000_000_000;

test("SP-6/11 AC4 — a token minted under a DIFFERENT secret is refused with reason 'bad-signature' (subject + content otherwise match)", () => {
  const serverSecret = freshSecret();
  const attackerSecret = freshSecret();
  const contentHash = approvalContentHash(SPEC_BODY);

  // The forger controls subject and content and gets them EXACTLY right — the
  // only thing they cannot produce is a MAC under the server's secret. Signature
  // is checked first, so this must fail on the signature, not the (matching)
  // subject or content.
  const forged = mintApproval(
    SUBJECT_KEY,
    contentHash,
    ISSUED_AT,
    attackerSecret,
  );

  const status = approvalStatus(forged, {
    subjectKey: SUBJECT_KEY,
    contentHash,
    secret: serverSecret,
  });
  assert.deepEqual(
    status,
    { ok: false, reason: "bad-signature" },
    "a token not authenticated under the server secret must be refused as bad-signature, even with a matching subject and content hash",
  );

  // Control: the SAME token DOES verify under the secret it was actually minted
  // with — so the refusal above is attributable to the wrong secret ALONE.
  assert.deepEqual(
    approvalStatus(forged, {
      subjectKey: SUBJECT_KEY,
      contentHash,
      secret: attackerSecret,
    }),
    { ok: true },
    "the token verifies under its own minting secret — pinning the refusal on the secret mismatch",
  );

  // Boolean wrapper agrees.
  assert.equal(
    verifyApproval(forged, {
      subjectKey: SUBJECT_KEY,
      contentHash,
      secret: serverSecret,
    }),
    false,
    "verifyApproval must reject a token forged under a different secret",
  );
});

test("SP-6/11 AC4 — a valid token TAMPERED after minting (MAC flipped) is refused with reason 'bad-signature'", () => {
  const secret = freshSecret();
  const contentHash = approvalContentHash(SPEC_BODY);

  const token = mintApproval(SUBJECT_KEY, contentHash, ISSUED_AT, secret);
  // Sanity: the pristine token verifies, so tampering is the only change below.
  assert.deepEqual(
    approvalStatus(token, { subjectKey: SUBJECT_KEY, contentHash, secret }),
    { ok: true },
    "precondition: the freshly minted token must verify under its secret",
  );

  // Flip the last character of the token (the trailing hex MAC), corrupting the
  // signature while leaving the payload's subject/content intact.
  const last = token[token.length - 1];
  const flipped = last === "0" ? "1" : "0";
  const tampered = token.slice(0, -1) + flipped;
  assert.notEqual(tampered, token, "the tamper must actually change the token");

  const status = approvalStatus(tampered, {
    subjectKey: SUBJECT_KEY,
    contentHash,
    secret,
  });
  assert.deepEqual(
    status,
    { ok: false, reason: "bad-signature" },
    "a token whose MAC has been altered must fail signature verification",
  );
  assert.equal(
    verifyApproval(tampered, { subjectKey: SUBJECT_KEY, contentHash, secret }),
    false,
    "verifyApproval must reject a tampered token",
  );
});

test("SP-6/11 AC4 — structurally garbage and absent tokens are refused with reason 'bad-signature', without throwing", () => {
  const secret = freshSecret();
  const contentHash = approvalContentHash(SPEC_BODY);
  const a = { subjectKey: SUBJECT_KEY, contentHash, secret };

  // Neither a well-formed base64url.payload.hexMac nor a real token — nothing
  // here can authenticate under the secret, so each is a signature failure. The
  // seam is TOTAL: it returns a refusal, never throws.
  const garbage: (string | undefined)[] = [
    undefined, // no token at all
    "", // empty string
    "not-a-token", // no separator, not base64
    "onlyonesegment", // missing the "." MAC separator
    "payload.", // empty MAC
    ".deadbeef", // empty payload
    `${Buffer.from("[]", "utf8").toString("base64url")}.deadbeef`, // valid base64, bogus MAC
  ];

  for (const bad of garbage) {
    const status = approvalStatus(bad, a);
    assert.deepEqual(
      status,
      { ok: false, reason: "bad-signature" },
      `a malformed/absent token (${JSON.stringify(bad)}) must be refused as bad-signature`,
    );
    assert.equal(
      verifyApproval(bad, a),
      false,
      `verifyApproval must reject a malformed/absent token (${JSON.stringify(bad)})`,
    );
  }
});
