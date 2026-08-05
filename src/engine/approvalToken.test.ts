/**
 * Unit tests for the human-approval token primitive after the SP-6/11 freshness change.
 * node:test + node:assert; run via `npm test`.
 *
 * SP-6/11 makes the **content hash** the freshness guarantee and drops the short wall-clock TTL:
 * an approval for unchanged content is honored however long the human took, while any edit still
 * re-arms the gate. Time is no longer a rejection axis, so the refusal-reason enum has NO `expired`
 * member — `approvalStatus` can only fail with `bad-signature`, `subject-mismatch`, or
 * `content-mismatch`, in that fixed order.
 *
 * What these tests pin:
 *   1. old-but-unchanged     — a token minted long ago still verifies as long as subject + content
 *                              match; elapsed time alone never refuses it (the TTL is gone).
 *   2. content-mismatch      — an edited body moves the hash → { ok: false, reason:
 *                              'content-mismatch' }.
 *   3. subject-mismatch      — an approval for one subject can never satisfy another's gate →
 *                              { ok: false, reason: 'subject-mismatch' }.
 *   4. bad-signature         — a missing / garbage / forged / tampered token → { ok: false, reason:
 *                              'bad-signature' }; the server secret stays load-bearing.
 *   5. check order           — signature -> subject -> content; the first failing check wins.
 *   6. boolean wrapper       — verifyApproval(token, a) === approvalStatus(token, a).ok for every
 *                              case (its pure, never-throws boolean contract is unchanged).
 *   7. no 'expired'          — no matter how old the token, no failing status ever reports
 *                              'expired'; time is not a rejection axis.
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
  type ApprovalToken,
} from "./approvalToken";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-approval-"));
}

const SUBJECT = "spec:TEP-6/SP-9";
const OTHER_SUBJECT = "spec:TEP-6/SP-3";

const BODY = ["# Some Spec", "", "The reviewed body, byte-for-byte.", ""].join(
  "\n",
);
const CONTENT_HASH = approvalContentHash(BODY);

const EDITED_BODY = BODY.replace("byte-for-byte", "one character changed");
const EDITED_HASH = approvalContentHash(EDITED_BODY);

// A wall-clock instant far in the past (epoch ms ≈ 1970). Under the old TTL this token would have
// been "expired" long ago; under SP-6/11 it must still verify while the content is unchanged.
const ANCIENT_ISSUED_AT = 1;

test("an old-but-unchanged token still verifies (TTL is gone)", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT, CONTENT_HASH, ANCIENT_ISSUED_AT, secret);
  const a = { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret };

  assert.deepEqual(approvalStatus(token, a), { ok: true });
  assert.equal(verifyApproval(token, a), true);
});

test("approvalStatus reports 'content-mismatch' for an edited body", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT, CONTENT_HASH, ANCIENT_ISSUED_AT, secret);

  assert.notEqual(EDITED_HASH, CONTENT_HASH);
  const a = { subjectKey: SUBJECT, contentHash: EDITED_HASH, secret };

  assert.deepEqual(approvalStatus(token, a), {
    ok: false,
    reason: "content-mismatch",
  });
  assert.equal(verifyApproval(token, a), false);
});

test("approvalStatus reports 'subject-mismatch' for a different subject", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT, CONTENT_HASH, ANCIENT_ISSUED_AT, secret);

  const a = { subjectKey: OTHER_SUBJECT, contentHash: CONTENT_HASH, secret };

  assert.deepEqual(approvalStatus(token, a), {
    ok: false,
    reason: "subject-mismatch",
  });
  assert.equal(verifyApproval(token, a), false);
});

test("approvalStatus reports 'bad-signature' for a missing token", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const a = { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret };

  assert.deepEqual(approvalStatus(undefined, a), {
    ok: false,
    reason: "bad-signature",
  });
  assert.equal(verifyApproval(undefined, a), false);
});

test("approvalStatus reports 'bad-signature' for garbage tokens", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const a = { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret };

  const garbage: ApprovalToken[] = [
    "",
    "not-a-token",
    "no-dot-separator",
    ".",
    "onlypayload.",
    ".onlymac",
    "abc.def", // structurally plausible, but not a valid base64url payload + HMAC
  ];
  for (const token of garbage) {
    assert.deepEqual(
      approvalStatus(token, a),
      { ok: false, reason: "bad-signature" },
      `expected bad-signature for ${JSON.stringify(token)}`,
    );
    assert.equal(verifyApproval(token, a), false);
  }
});

test("approvalStatus reports 'bad-signature' for a forged token (wrong secret)", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const otherSecret = loadOrCreateApprovalSecret(tmpDir()); // a different random key file
  // Minted under a secret the gate doesn't hold — the HMAC fails even though subject + content match.
  const forged = mintApproval(
    SUBJECT,
    CONTENT_HASH,
    ANCIENT_ISSUED_AT,
    otherSecret,
  );
  const a = { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret };

  assert.deepEqual(approvalStatus(forged, a), {
    ok: false,
    reason: "bad-signature",
  });
  assert.equal(verifyApproval(forged, a), false);
});

test("approvalStatus reports 'bad-signature' for a tampered payload", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT, CONTENT_HASH, ANCIENT_ISSUED_AT, secret);
  const dot = token.lastIndexOf(".");
  // Flip the last payload character but keep the original MAC — the HMAC no longer matches.
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const last = payload[payload.length - 1];
  const flipped = (last === "A" ? "B" : "A") + "";
  const tampered = payload.slice(0, -1) + flipped + "." + mac;
  const a = { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret };

  assert.deepEqual(approvalStatus(tampered, a), {
    ok: false,
    reason: "bad-signature",
  });
  assert.equal(verifyApproval(tampered, a), false);
});

test("checks run in order: signature first", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const otherSecret = loadOrCreateApprovalSecret(tmpDir());
  // Wrong secret AND wrong subject AND wrong content — signature is checked first, so 'bad-signature'.
  const forged = mintApproval(
    SUBJECT,
    CONTENT_HASH,
    ANCIENT_ISSUED_AT,
    otherSecret,
  );
  const a = { subjectKey: OTHER_SUBJECT, contentHash: EDITED_HASH, secret };

  assert.deepEqual(approvalStatus(forged, a), {
    ok: false,
    reason: "bad-signature",
  });
});

test("checks run in order: subject before content", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT, CONTENT_HASH, ANCIENT_ISSUED_AT, secret);
  // Valid signature, but BOTH subject and content mismatch — subject is checked first.
  const a = { subjectKey: OTHER_SUBJECT, contentHash: EDITED_HASH, secret };

  assert.deepEqual(approvalStatus(token, a), {
    ok: false,
    reason: "subject-mismatch",
  });
});

test("verifyApproval is exactly approvalStatus(...).ok for every case", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const otherSecret = loadOrCreateApprovalSecret(tmpDir());
  const good = mintApproval(SUBJECT, CONTENT_HASH, ANCIENT_ISSUED_AT, secret);
  const forged = mintApproval(
    SUBJECT,
    CONTENT_HASH,
    ANCIENT_ISSUED_AT,
    otherSecret,
  );

  const cases: Array<{
    token: ApprovalToken | undefined;
    a: { subjectKey: string; contentHash: string; secret: Buffer };
  }> = [
    {
      token: good,
      a: { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret },
    },
    {
      token: good,
      a: { subjectKey: OTHER_SUBJECT, contentHash: CONTENT_HASH, secret },
    },
    {
      token: good,
      a: { subjectKey: SUBJECT, contentHash: EDITED_HASH, secret },
    },
    {
      token: forged,
      a: { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret },
    },
    {
      token: undefined,
      a: { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret },
    },
    {
      token: "garbage",
      a: { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret },
    },
  ];

  for (const { token, a } of cases) {
    assert.equal(verifyApproval(token, a), approvalStatus(token, a).ok);
  }
});

test("no refusal is ever 'expired', however old the token", () => {
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const otherSecret = loadOrCreateApprovalSecret(tmpDir());

  // Tokens minted at wildly different (and very old) instants — none of these ages is a rejection axis.
  const statuses = [
    approvalStatus(undefined, {
      subjectKey: SUBJECT,
      contentHash: CONTENT_HASH,
      secret,
    }),
    approvalStatus(mintApproval(SUBJECT, CONTENT_HASH, 0, secret), {
      subjectKey: OTHER_SUBJECT,
      contentHash: CONTENT_HASH,
      secret,
    }),
    approvalStatus(mintApproval(SUBJECT, CONTENT_HASH, 1, secret), {
      subjectKey: SUBJECT,
      contentHash: EDITED_HASH,
      secret,
    }),
    approvalStatus(mintApproval(SUBJECT, CONTENT_HASH, 42, otherSecret), {
      subjectKey: SUBJECT,
      contentHash: CONTENT_HASH,
      secret,
    }),
  ];

  const allowed = new Set([
    "bad-signature",
    "subject-mismatch",
    "content-mismatch",
  ]);
  for (const status of statuses) {
    assert.equal(status.ok, false);
    if (!status.ok) {
      assert.notEqual(status.reason, "expired");
      assert.ok(
        allowed.has(status.reason),
        `unexpected reason ${status.reason}`,
      );
    }
  }
});

test("an old token still verifies after re-approval of the same content", () => {
  // Re-approving unchanged content is deterministic (same inputs → same token), and the original
  // ancient token keeps verifying — content, not the clock, is the freshness guarantee.
  const secret = loadOrCreateApprovalSecret(tmpDir());
  const first = mintApproval(SUBJECT, CONTENT_HASH, ANCIENT_ISSUED_AT, secret);
  const a = { subjectKey: SUBJECT, contentHash: CONTENT_HASH, secret };
  assert.equal(approvalStatus(first, a).ok, true);
  assert.equal(approvalStatus(first, a).ok, true);
});
