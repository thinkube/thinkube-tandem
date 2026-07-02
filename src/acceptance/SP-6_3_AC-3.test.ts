/**
 * SP-6/3 (TEP-6) AC3 — The token is server-bound, not agent-reproducible.
 *
 * An approval verifies under the server approval secret and fails verification
 * under a wrong or absent secret — so a token written WITHOUT the server secret
 * never passes, no matter how it was produced or delivered.
 *
 * Exercised strictly through the contract's public interface:
 *   - `mintApproval` / `verifyApproval` / `loadOrCreateApprovalSecret` /
 *     `approvalContentHash` / `APPROVAL_TTL_MS` from src/services/approvalToken.ts
 *   - `createApprovalStore` from src/services/approvalStore.ts (the side-channel
 *     the gate reads — an agent "writing its own token into the store" goes
 *     through exactly this `put`, so we prove that path is inert too).
 *
 * What these tests pin:
 *   1. Positive control — mint under the server secret, verify under the same
 *      secret → true. (Without this, every negative below could be an
 *      always-false verifier.)
 *   2. Wrong secret — the SAME token fails to verify under any other secret
 *      (another server's persisted secret, or an arbitrary agent-chosen key).
 *   3. Absent secret — verification under an empty secret fails; and no token
 *      an agent could mint with an empty/guessed key verifies under the real
 *      server secret. `verifyApproval` never throws in any of these cases.
 *   4. Not agent-reproducible — an agent who knows EVERYTHING except the secret
 *      (exact subjectKey, exact contentHash via the exported helper, exact
 *      issuedAt) still cannot produce a passing token: mints under its own key,
 *      hand-crafted payload encodings, and the reproducible content hash itself
 *      all fail under the server secret.
 *   5. Side-channel delivery is no bypass — a forged token `put` into the
 *      approval store is still rejected when read back and verified under the
 *      server secret, while a genuinely-minted token round-trips to true.
 *   6. The secret is real and persistent — same storageDir → same bytes (an
 *      approval survives a reload); different storageDirs → tokens do not
 *      cross-verify.
 *
 * Timestamps are fixed and `now === issuedAt` (well within `APPROVAL_TTL_MS`),
 * and subjectKey/contentHash always match the verify args — so the ONLY thing
 * deciding each verdict here is the secret. Expiry / wrong-subject /
 * wrong-content rejection are sibling units (AC2, AC4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  APPROVAL_TTL_MS,
  mintApproval,
  verifyApproval,
  loadOrCreateApprovalSecret,
  approvalContentHash,
  type ApprovalToken,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";

// ── fixtures ──────────────────────────────────────────────────────────────────

function tmpDir(prefix = "tk-approval-ac3-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The gate's kind-namespaced subject for a spec. */
const SUBJECT_KEY = "spec:TEP-6/SP-3";

/** A representative reviewed document body, hashed by THE exported helper —
 *  the same function the gate applies — so content never mismatches here. */
const SPEC_BODY = [
  "# A real human-approval signal",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] The token is server-bound.",
  "",
].join("\n");
const CONTENT_HASH = approvalContentHash(SPEC_BODY);

/** Fixed clock: minted and verified at the same instant → always within TTL. */
const NOW = 1_750_000_000_000; // epoch ms, arbitrary but deterministic

/** Verify-args under a given secret, everything else matching the mint. */
const argsWith = (secret: Buffer) => ({
  subjectKey: SUBJECT_KEY,
  contentHash: CONTENT_HASH,
  now: NOW,
  secret,
  ttlMs: APPROVAL_TTL_MS,
});

// ── 1. positive control: server secret round-trip ─────────────────────────────

test("verifies under the server secret (round-trip positive control)", () => {
  const serverSecret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT_KEY, CONTENT_HASH, NOW, serverSecret);

  assert.equal(typeof token, "string", "the token is an opaque string payload");
  assert.ok(token.length > 0, "the token is non-empty");
  assert.equal(
    verifyApproval(token, argsWith(serverSecret)),
    true,
    "a token minted under the server secret must verify under that secret " +
      "(same subject, same content, within TTL)",
  );
});

// ── 2. the SAME token fails under any wrong secret ────────────────────────────

test("fails verification under a wrong secret — the secret is load-bearing", () => {
  const serverSecret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT_KEY, CONTENT_HASH, NOW, serverSecret);

  // Another server's genuinely-created secret (a different random key file)…
  const otherServerSecret = loadOrCreateApprovalSecret(tmpDir());
  assert.notDeepEqual(
    otherServerSecret,
    serverSecret,
    "two storageDirs must not share a secret (precondition for this test)",
  );
  assert.equal(
    verifyApproval(token, argsWith(otherServerSecret)),
    false,
    "a token must not verify under a different server's secret",
  );

  // …and arbitrary agent-chosen keys, including a near-miss (one flipped bit).
  const nearMiss = Buffer.from(serverSecret);
  nearMiss[0] = nearMiss[0] ^ 0x01;
  for (const wrong of [
    Buffer.from("agent-invented-secret"),
    Buffer.alloc(serverSecret.length, 0),
    nearMiss,
  ]) {
    assert.equal(
      verifyApproval(token, argsWith(wrong)),
      false,
      "a token must not verify under any secret other than the exact server secret",
    );
  }
});

// ── 3. absent secret: fails closed, never throws ──────────────────────────────

test("fails verification under an absent (empty) secret, without throwing", () => {
  const serverSecret = loadOrCreateApprovalSecret(tmpDir());
  const token = mintApproval(SUBJECT_KEY, CONTENT_HASH, NOW, serverSecret);
  const absent = Buffer.alloc(0);

  let verdict: boolean | undefined;
  assert.doesNotThrow(() => {
    verdict = verifyApproval(token, argsWith(absent));
  }, "verifyApproval is pure and never throws — even with an empty secret");
  assert.equal(
    verdict,
    false,
    "verification with no real secret must fail closed",
  );
});

// ── 4. not agent-reproducible: everything-but-the-secret is not enough ────────

test("a token minted WITHOUT the server secret never passes, even with the exact payload", () => {
  const serverSecret = loadOrCreateApprovalSecret(tmpDir());
  const args = argsWith(serverSecret);

  // The agent can know the exact subjectKey, the exact contentHash (the hash
  // helper is exported and reproducible), and the exact issuedAt. What it
  // cannot know is the secret. Mints under agent-available keys:
  const forgeries: ApprovalToken[] = [];
  for (const agentKey of [
    Buffer.from("the user said go"),
    Buffer.from("agent-guess"),
    Buffer.alloc(32, 7),
  ]) {
    forgeries.push(mintApproval(SUBJECT_KEY, CONTENT_HASH, NOW, agentKey));
  }
  // An empty-key mint, if the module even allows it, is equally a forgery;
  // if mint refuses an empty key outright, that's the same guarantee.
  try {
    forgeries.push(
      mintApproval(SUBJECT_KEY, CONTENT_HASH, NOW, Buffer.alloc(0)),
    );
  } catch {
    /* mint refusing an empty secret also means "cannot produce one" */
  }

  // Plus hand-crafted encodings of the very payload the token signs over —
  // no signing at all, just the data:
  const payload = {
    subjectKey: SUBJECT_KEY,
    contentHash: CONTENT_HASH,
    issuedAt: NOW,
  };
  forgeries.push(
    JSON.stringify(payload),
    Buffer.from(JSON.stringify(payload)).toString("base64"),
    `${SUBJECT_KEY}|${CONTENT_HASH}|${NOW}`,
    CONTENT_HASH, // the reproducible content hash presented AS the token
    "",
    "approved",
  );

  for (const forged of forgeries) {
    let verdict: boolean | undefined;
    assert.doesNotThrow(() => {
      verdict = verifyApproval(forged, args);
    }, "verifyApproval never throws, even on malformed/garbage tokens");
    assert.equal(
      verdict,
      false,
      `a token produced without the server secret must never verify (forgery: ${JSON.stringify(
        forged,
      ).slice(0, 80)})`,
    );
  }

  // And an absent token (nothing in the store at all) is equally a fail.
  assert.equal(
    verifyApproval(undefined, args),
    false,
    "no token at all must never verify",
  );
});

// ── 5. the side-channel store is delivery, not authority ──────────────────────

test("writing a self-minted token into the approval store does not make it pass", () => {
  const storageDir = tmpDir();
  const serverSecret = loadOrCreateApprovalSecret(storageDir);
  const store = createApprovalStore(storageDir);

  // The agent forges a token over the exact right payload under its own key
  // and delivers it through the very same `put` the host's Approve button uses.
  const forged = mintApproval(
    SUBJECT_KEY,
    CONTENT_HASH,
    NOW,
    Buffer.from("agent-side-secret"),
  );
  store.put(SUBJECT_KEY, forged);

  // The gate's read path: get from the store, verify under the SERVER secret.
  assert.equal(
    verifyApproval(store.get(SUBJECT_KEY), argsWith(serverSecret)),
    false,
    "a self-minted token delivered via the side-channel store must still fail " +
      "verification under the server secret — store access is not authority",
  );

  // Positive control on the same store + subject: the host's genuine mint
  // (server secret from the SAME storageDir) round-trips to true — proving the
  // rejection above was the forged signature, not a broken store or verifier.
  const genuine = mintApproval(SUBJECT_KEY, CONTENT_HASH, NOW, serverSecret);
  store.put(SUBJECT_KEY, genuine);
  assert.equal(
    verifyApproval(store.get(SUBJECT_KEY), argsWith(serverSecret)),
    true,
    "a genuinely server-minted token delivered through the same store must verify",
  );
});

// ── 6. the secret is real: persistent per storageDir, disjoint across dirs ────

test("loadOrCreateApprovalSecret persists per storageDir, so approvals survive and never cross dirs", () => {
  const dirA = tmpDir();
  const dirB = tmpDir();

  // Same dir → same bytes: a token minted before a host reload still verifies.
  const first = loadOrCreateApprovalSecret(dirA);
  assert.ok(Buffer.isBuffer(first), "the secret is a Buffer");
  assert.ok(first.length > 0, "the secret is non-empty");
  const token = mintApproval(SUBJECT_KEY, CONTENT_HASH, NOW, first);

  const reloaded = loadOrCreateApprovalSecret(dirA);
  assert.deepEqual(
    reloaded,
    first,
    "the same storageDir yields the same secret",
  );
  assert.equal(
    verifyApproval(token, argsWith(reloaded)),
    true,
    "an approval minted before a reload must still verify under the reloaded secret",
  );

  // Different dir → different secret → the token does not verify there.
  const foreign = loadOrCreateApprovalSecret(dirB);
  assert.notDeepEqual(
    foreign,
    first,
    "distinct storageDirs yield distinct secrets",
  );
  assert.equal(
    verifyApproval(token, argsWith(foreign)),
    false,
    "an approval must be bound to ITS server's secret, not any secret",
  );
});
