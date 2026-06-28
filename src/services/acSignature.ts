// Provenance signature for the `ac_verifications` map (SP-6/1, TEP-6).
//
// `write_spec` runs the verifiability auditor itself and signs the certified `ac_verifications`
// with a secret only the server process holds — so a spec's criteria count as audited *only if the
// tool produced them*. This module is that signing primitive: an HMAC over the pair
// `(AC-block hash, ac_verifications)` keyed by a server-only secret, plus the loader that
// reads/creates that secret in the extension's `globalStorage` (never written to a thinking space
// or repo the agent can read).
//
// Why bind both halves:
//   - The **AC-block hash** (`acRequirementHash`, the `ac_verifications_hash` frontmatter field) is
//     reproducible by anyone — the agent can recompute it. Signing it alone would let a hand-supplied
//     map ride a stale-but-matching hash. So the signature is keyed by a secret the agent cannot
//     reproduce: the gate trusts the HMAC, not the plain hash.
//   - The **map** is what we are certifying. Tying the signature to *this* map over *this* AC block
//     means re-using a signature for a different map (or a different AC block) fails verification.
//
// Pure / synchronous / Node-only (`node:crypto`, `node:fs`) — no VS Code API — so it is unit-testable
// without a model call or an Extension Host. `readyGate` (its sibling unit) verifies the signature
// these helpers produce.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AcVerificationMap } from "./openingGate";

/** File name of the HMAC secret inside `globalStorage`. */
export const AC_SIGNING_KEY_FILE = "ac-signing-key";

/**
 * Frontmatter key under which `write_spec` stamps the provenance signature, beside
 * {@link AC_CERT_HASH_KEY} (`ac_verifications_hash`). `readyGate` reads this field and verifies it;
 * a map without a valid value here is refused.
 */
export const AC_SIGNATURE_KEY = "ac_verifications_signature";

/** Domain-separation tag mixed into the signed payload so this HMAC can't collide with any other. */
const SIGNATURE_DOMAIN = "thinkube/ac_verifications/v1";

/**
 * The secret bytes used to key the HMAC. A thin Buffer wrapper kept as a distinct type so callers
 * can't accidentally pass an AC hash or a signature where the key belongs.
 */
export type AcSigningSecret = Buffer;

/**
 * Load the server signing secret from `globalStorage`, creating it on first use.
 *
 * The secret **never leaves the server process** (Spec constraint): it lives only as a file in the
 * extension's `globalStorage` directory — passed in here as `storageDir` rather than read from the
 * VS Code API so this stays unit-testable — and is never written to a thinking space or repo. On
 * first call the directory is created if needed and 32 random bytes are written (hex, owner-only
 * `0o600`); subsequent calls read the same bytes back, so a signature made in one session verifies
 * in the next.
 */
export function loadOrCreateSecret(storageDir: string): AcSigningSecret {
  const keyPath = join(storageDir, AC_SIGNING_KEY_FILE);
  if (existsSync(keyPath)) {
    const hex = readFileSync(keyPath, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    // A truncated / corrupt key file would silently weaken every signature — refuse it loudly
    // rather than sign with a short or empty secret.
    if (buf.length === 0 || buf.length * 2 !== hex.length) {
      throw new Error(
        `AC signing key at ${keyPath} is malformed (expected hex-encoded bytes)`,
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
 * Canonical, stable serialization of the signed payload `(acHash, ac_verifications)`.
 *
 * Object key order in JS is insertion order, so two maps with the same entries in a different order
 * would serialize differently and break verification. We therefore sort AC ordinals numerically and
 * each declaration's fields lexicographically, and prefix the AC hash + a domain tag — yielding one
 * deterministic byte string for a given (hash, map) regardless of how the map was assembled.
 */
function canonicalPayload(
  acHash: string,
  acVerifications: AcVerificationMap,
): string {
  const ordinals = Object.keys(acVerifications).sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  );
  const canonicalMap = ordinals.map((ordinal) => {
    const decl = acVerifications[ordinal] ?? {};
    const fields = Object.keys(decl)
      .sort()
      .map((k) => [k, (decl as Record<string, unknown>)[k]] as const);
    return [ordinal, fields];
  });
  return JSON.stringify([SIGNATURE_DOMAIN, acHash, canonicalMap]);
}

/**
 * Sign the pair `(acHash, ac_verifications)` with the server `secret`. Returns a lowercase-hex
 * HMAC-SHA256 digest — the value stamped under {@link AC_SIGNATURE_KEY}. Deterministic: the same
 * inputs always yield the same signature, so a freshly-signed map verifies.
 */
export function signAcVerifications(
  acHash: string,
  acVerifications: AcVerificationMap,
  secret: AcSigningSecret,
): string {
  return createHmac("sha256", secret)
    .update(canonicalPayload(acHash, acVerifications))
    .digest("hex");
}

/**
 * Verify a provenance `signature` over `(acHash, ac_verifications)` under the server `secret`.
 *
 * Returns true **iff** the signature was produced by {@link signAcVerifications} over the *same*
 * AC hash and map with the *same* secret. A wrong/absent secret, a tampered map, a mismatched AC
 * hash, or a non-hex / wrong-length signature all return false (never throw). Comparison is
 * constant-time ({@link timingSafeEqual}) to avoid leaking the expected digest byte-by-byte.
 */
export function verifyAcSignature(
  acHash: string,
  acVerifications: AcVerificationMap,
  signature: unknown,
  secret: AcSigningSecret,
): boolean {
  if (typeof signature !== "string" || signature.length === 0) return false;
  const expected = signAcVerifications(acHash, acVerifications, secret);
  // Equal-length hex strings only; timingSafeEqual throws on length mismatch.
  if (signature.length !== expected.length) return false;
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
