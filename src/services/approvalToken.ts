// Human-approval token primitive for decision-point gates (SP-6/3, TEP-6 mechanism 2).
//
// The review panel's Approve button — a UI action only the maintainer can take — mints a
// short-lived, content-bound token signed by a server-only secret; `create_slice` / the spec→Ready
// transition verify it and refuse otherwise. This module is that mint+verify primitive: an HMAC
// over the triple `(subjectKey, contentHash, issuedAt)` keyed by a secret only the host/server
// process holds, plus the loader that reads/creates that secret under a storage directory the
// agent never reads (the extension's `globalStorage`, injected as `THINKUBE_APPROVAL_DIR` on the
// server side). It is `acSignature.ts` widened from `(spec, issuedAt)` to a generic,
// kind-namespaced subject plus a content hash.
//
// Why each binding exists:
//   - **secret** — the agent cannot forge the HMAC, so it cannot synthesize the human's "go".
//   - **subjectKey** (kind-namespaced, e.g. `spec:TEP-6/SP-3` vs `tep:TEP-6`) — an approval for
//     one subject can never satisfy another subject's gate.
//   - **contentHash** — the token certifies *what the human saw*: editing the document changes
//     the hash, so a prior approval stops verifying and the panel re-arms Approve. This — not a
//     wall clock — is the freshness guarantee: an unchanged spec stays approved however long the
//     human took, while any edit re-arms the gate. `issuedAt` remains in the signed payload for
//     audit/debug but is no longer a rejection criterion.
//
// Kind-agnostic and pure: no `vscode` API, secret/content-hash all injectable via parameters,
// `approvalStatus`/`verifyApproval` synchronous and never-throwing — so signature-binding,
// subject-mismatch and content-mismatch are unit-testable with no UI or model in the loop.
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * An opaque signed payload over `(subjectKey, contentHash, issuedAt)`.
 *
 * Wire shape (an implementation detail — callers must treat the value as opaque):
 * `base64url(JSON payload) + "." + hex HMAC-SHA256(payload)`. The payload rides inside the token
 * so the gate needs nothing but the token, the current subject/content, a clock and the secret.
 */
export type ApprovalToken = string;

/** File name of the approval HMAC secret inside the storage directory. */
export const APPROVAL_SECRET_FILE = "approval-signing-key";

/**
 * Domain-separation tag mixed into the signed payload so this HMAC can't collide with any other
 * signature in the system (notably `acSignature.ts`, which shares the storage-dir + HMAC pattern).
 */
const TOKEN_DOMAIN = "thinkube/approval-token/v1";

/**
 * Load the server-only approval secret from `storageDir`, creating it on first use.
 *
 * The secret **never leaves the host/server process** (Spec constraint): it lives only as a file
 * under the extension's `globalStorage` directory — passed in here as `storageDir` rather than
 * read from the VS Code API so this stays unit-testable — and is never written to a thinking
 * space or repo the agent can read. One shared secret backs every subject. On first call the
 * directory is created if needed and 32 random bytes are written (hex, owner-only `0o600`);
 * subsequent calls read the same bytes back, so a token minted by the host verifies in the
 * detached MCP server process pointed at the same directory.
 */
export function loadOrCreateApprovalSecret(storageDir: string): Buffer {
  const keyPath = join(storageDir, APPROVAL_SECRET_FILE);
  if (existsSync(keyPath)) {
    const hex = readFileSync(keyPath, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    // A truncated / corrupt key file would silently weaken every token — refuse it loudly rather
    // than sign with a short or empty secret.
    if (buf.length === 0 || buf.length * 2 !== hex.length) {
      throw new Error(
        `Approval secret at ${keyPath} is malformed (expected hex-encoded bytes)`,
      );
    }
    return buf;
  }
  mkdirSync(storageDir, { recursive: true });
  const secret = randomBytes(32);
  writeFileSync(keyPath, secret.toString("hex"), { mode: 0o600 });
  return secret;
}

/**
 * THE content hash the gate applies to the current document body — SHA-256 over the exact UTF-8
 * bytes, lowercase hex.
 *
 * Both sides of the protocol call this same function on the same on-disk bytes: the host's
 * Approve handler hashes the body it just rendered, and the gate hashes the *current* `spec.md`
 * body — so a mint for the current content matches exactly what the gate checks, and any edit
 * (however small) moves the hash and invalidates the approval. No normalization on purpose: the
 * on-disk file is the single source of truth, and "what the human saw" is its exact bytes.
 */
export function approvalContentHash(body: string): string {
  return createHash("sha256")
    .update(TOKEN_DOMAIN + "\n")
    .update(body, "utf8")
    .digest("hex");
}

/** Deterministic serialization of the signed triple — one byte string per (subject, hash, time). */
function canonicalPayload(
  subjectKey: string,
  contentHash: string,
  issuedAt: number,
): string {
  return JSON.stringify([TOKEN_DOMAIN, subjectKey, contentHash, issuedAt]);
}

/**
 * Mint an approval token over `(subjectKey, contentHash, issuedAt)` under the server `secret`.
 *
 * Called by the host when the maintainer clicks Approve — with `subjectKey` the kind-namespaced
 * subject (e.g. `spec:TEP-6/SP-3`), `contentHash` = {@link approvalContentHash} of the reviewed
 * body, and `issuedAt` the current epoch ms (injected, not read from a clock, so expiry is
 * unit-testable). Deterministic: the same inputs always yield the same token.
 */
export function mintApproval(
  subjectKey: string,
  contentHash: string,
  issuedAt: number,
  secret: Buffer,
): ApprovalToken {
  const payload = canonicalPayload(subjectKey, contentHash, issuedAt);
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${mac}`;
}

/**
 * Why an approval token was refused.
 *
 * Time is **not** a rejection axis (content-binding is the freshness guarantee), so there is no
 * `'expired'` member — a refusal can only be one of these three:
 *   - `'bad-signature'` — missing/garbage/forged token, wrong shape, or HMAC fails under the secret;
 *   - `'subject-mismatch'` — a valid token, but minted for a different subject;
 *   - `'content-mismatch'` — a valid token for this subject, but the document changed since approval.
 */
export type ApprovalRefusalReason =
  "bad-signature" | "subject-mismatch" | "content-mismatch";

/** The outcome of {@link approvalStatus}: approved, or refused with a single reason. */
export type ApprovalStatus =
  { ok: true } | { ok: false; reason: ApprovalRefusalReason };

/**
 * Verify an approval token against *this gate's* expectations, reporting *why* it was refused.
 * Pure, synchronous, never throws.
 *
 * Runs the three surviving checks IN ORDER — signature → subject → content — and returns the
 * first that fails; `{ ok: true }` iff all pass:
 *   - **signature** — a token is present, structurally well-formed, its payload is our
 *     domain-tagged 4-tuple, and its HMAC verifies under `a.secret` (constant-time compare — a
 *     token minted with any other secret, or with tampered payload bytes, fails here). Any of
 *     missing token, garbage encoding, wrong shape, forged/truncated MAC → `'bad-signature'`.
 *   - **subject** — its `subjectKey` equals `a.subjectKey` (an approval for `tep:TEP-6` can never
 *     satisfy the `spec:TEP-6/SP-3` gate) → else `'subject-mismatch'`.
 *   - **content** — its `contentHash` equals `a.contentHash` (the hash of the *current* document;
 *     an approval of an earlier revision stops matching the moment the document changes) → else
 *     `'content-mismatch'`.
 *
 * There is no `now`/`ttlMs` parameter and no time-based refusal: an approval of unchanged content
 * is honored however long the human took, while any edit moves the content hash and re-arms the
 * gate. `issuedAt` still rides in the signed payload for audit/debug — it is simply not checked.
 */
export function approvalStatus(
  token: ApprovalToken | undefined,
  a: { subjectKey: string; contentHash: string; secret: Buffer },
): ApprovalStatus {
  try {
    if (typeof token !== "string" || token.length === 0)
      return { ok: false, reason: "bad-signature" };
    const dot = token.lastIndexOf(".");
    if (dot <= 0 || dot === token.length - 1)
      return { ok: false, reason: "bad-signature" };
    const payloadB64 = token.slice(0, dot);
    const mac = token.slice(dot + 1);

    // 1. Signature first: nothing in the payload is trusted until the HMAC checks out.
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = createHmac("sha256", a.secret)
      .update(payload)
      .digest("hex");
    if (mac.length !== expected.length)
      return { ok: false, reason: "bad-signature" };
    const macBuf = Buffer.from(mac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (macBuf.length !== expectedBuf.length || macBuf.length === 0)
      return { ok: false, reason: "bad-signature" };
    if (!timingSafeEqual(macBuf, expectedBuf))
      return { ok: false, reason: "bad-signature" };

    // Shape is part of "is this a valid signature over our payload?": a well-signed but wrongly
    // shaped payload is still not a token we minted, so it fails as 'bad-signature'.
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length !== 4)
      return { ok: false, reason: "bad-signature" };
    const [domain, subjectKey, contentHash, issuedAt] = parsed as unknown[];
    if (domain !== TOKEN_DOMAIN) return { ok: false, reason: "bad-signature" };
    if (typeof subjectKey !== "string" || typeof contentHash !== "string")
      return { ok: false, reason: "bad-signature" };
    if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt))
      return { ok: false, reason: "bad-signature" };

    // 2. Subject binding: this approval must be for this exact subject.
    if (subjectKey !== a.subjectKey)
      return { ok: false, reason: "subject-mismatch" };

    // 3. Content binding: the document must be unchanged since approval.
    if (contentHash !== a.contentHash)
      return { ok: false, reason: "content-mismatch" };

    return { ok: true };
  } catch {
    // Malformed base64 / JSON / anything unexpected — an invalid token, never an exception.
    return { ok: false, reason: "bad-signature" };
  }
}

/**
 * Back-compat boolean wrapper over {@link approvalStatus} — true iff the token passes all three
 * checks. Pure, synchronous, never throws; existing callers that only need pass/fail are unchanged.
 */
export function verifyApproval(
  token: ApprovalToken | undefined,
  a: { subjectKey: string; contentHash: string; secret: Buffer },
): boolean {
  return approvalStatus(token, a).ok;
}
