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
//     the hash, so a prior approval stops verifying and the panel re-arms Approve.
//   - **issuedAt + TTL** — the approval is a recent signal, not a standing capability.
//
// Kind-agnostic and pure: no `vscode` API, secret/clock/content-hash all injectable via
// parameters, `verifyApproval` synchronous and never-throwing — so signature-binding, expiry,
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

/**
 * How long an approval stays valid, in milliseconds — the TTL the armed gate enforces.
 *
 * 15 minutes: long enough to click Approve and let the agent run `create_slice` over a Spec's
 * slices in one sitting, short enough that a stale approval from an earlier session cannot be
 * ridden later. (Content-binding, not the TTL, is what invalidates an approval when the document
 * changes.)
 */
export const APPROVAL_TTL_MS = 15 * 60 * 1000;

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
 * Verify an approval token against *this gate's* expectations. Pure, synchronous, never throws.
 *
 * Returns true **iff** every check holds:
 *   - a token is present and structurally well-formed;
 *   - its HMAC verifies under `a.secret` (constant-time compare — a token minted with any other
 *     secret, or with tampered payload bytes, fails here);
 *   - its `subjectKey` equals `a.subjectKey` (an approval for `tep:TEP-6` can never satisfy the
 *     `spec:TEP-6/SP-3` gate, and vice versa);
 *   - its `contentHash` equals `a.contentHash` (the hash of the *current* document — an approval
 *     of an earlier revision stops verifying the moment the document changes);
 *   - it is fresh: `a.now - issuedAt <= a.ttlMs`.
 *
 * Anything else — missing token, garbage encoding, wrong shape, forged or truncated MAC, subject
 * or content mismatch, expiry — returns false. Callers (the gate) turn that false into a refusal
 * that directs the maintainer to the Approve action.
 */
export function verifyApproval(
  token: ApprovalToken | undefined,
  a: {
    subjectKey: string;
    contentHash: string;
    now: number;
    secret: Buffer;
    ttlMs: number;
  },
): boolean {
  try {
    if (typeof token !== "string" || token.length === 0) return false;
    const dot = token.lastIndexOf(".");
    if (dot <= 0 || dot === token.length - 1) return false;
    const payloadB64 = token.slice(0, dot);
    const mac = token.slice(dot + 1);

    // 1. Signature first: nothing in the payload is trusted until the HMAC checks out.
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = createHmac("sha256", a.secret)
      .update(payload)
      .digest("hex");
    if (mac.length !== expected.length) return false;
    const macBuf = Buffer.from(mac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (macBuf.length !== expectedBuf.length || macBuf.length === 0)
      return false;
    if (!timingSafeEqual(macBuf, expectedBuf)) return false;

    // 2. Shape: the signed payload must be exactly our domain-tagged triple.
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length !== 4) return false;
    const [domain, subjectKey, contentHash, issuedAt] = parsed as unknown[];
    if (domain !== TOKEN_DOMAIN) return false;
    if (typeof subjectKey !== "string" || typeof contentHash !== "string")
      return false;
    if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt))
      return false;

    // 3. Bindings: this subject, this content, still fresh.
    if (subjectKey !== a.subjectKey) return false;
    if (contentHash !== a.contentHash) return false;
    if (a.now - issuedAt > a.ttlMs) return false;

    return true;
  } catch {
    // Malformed base64 / JSON / anything unexpected — an invalid token, never an exception.
    return false;
  }
}
