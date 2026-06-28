/**
 * Unit tests for the `ac_verifications` provenance signature (SP-6/1 AC2, TEP-6).
 * node:test + node:assert; run via `npm test`.
 *
 * AC2 ("The signature is bound to the server secret"): a signature over `(AC-block hash,
 * ac_verifications)` (a) **verifies with the server secret**, (b) **fails verification under a
 * wrong/absent secret**, and (c) **is distinct from the reproducible `acRequirementHash`** —
 * recomputing that hash does not satisfy the gate. This unit owns the sign/verify primitive and its
 * secret loader; the `readyGate` enforcement that calls `verifyAcSignature` is a sibling unit.
 *
 * What these tests pin:
 *   1. verifies-with-key  — sign(secret) then verify(secret) is true (round-trip).
 *   2. fails-without      — verify under a *different* secret, an absent/empty signature, or a
 *                           tampered map / AC hash is false (the secret is load-bearing).
 *   3. differs-from-hash  — the signature is not the `acRequirementHash`, and presenting that
 *                           reproducible hash as a "signature" does not verify (closes the
 *                           hand-supplied-map bypass the Spec calls out).
 *   4. secret persistence — `loadOrCreateSecret` creates a 0o600 hex key on first use and returns
 *                           the *same* bytes on later calls, so a signature survives across sessions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  AC_SIGNATURE_KEY,
  AC_SIGNING_KEY_FILE,
  loadOrCreateSecret,
  signAcVerifications,
  verifyAcSignature,
} from "./acSignature";
import { acRequirementHash, type AcVerificationMap } from "./openingGate";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tk-acsig-"));
}

const SPEC_BODY = [
  "# Some Spec",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] **One.** The tool does the thing.",
  "- [ ] **Two.** The thing is signed.",
  "",
  "## Design",
  "",
  "Irrelevant to the AC hash.",
  "",
].join("\n");

const AC_HASH = acRequirementHash(SPEC_BODY);

const MAP: AcVerificationMap = {
  "1": { run: "npm test -- one", env: "local" },
  "2": { run: "npm test -- two", env: "local" },
};

test("verifies with the server secret (round-trip)", () => {
  const secret = loadOrCreateSecret(tmpDir());
  const sig = signAcVerifications(AC_HASH, MAP, secret);
  assert.equal(typeof sig, "string");
  assert.ok(sig.length > 0);
  assert.equal(verifyAcSignature(AC_HASH, MAP, sig, secret), true);
});

test("signing is deterministic for the same (hash, map, secret)", () => {
  const secret = loadOrCreateSecret(tmpDir());
  const a = signAcVerifications(AC_HASH, MAP, secret);
  const b = signAcVerifications(AC_HASH, MAP, secret);
  assert.equal(a, b);
});

test("signature is independent of map key insertion order", () => {
  const secret = loadOrCreateSecret(tmpDir());
  const reordered: AcVerificationMap = {
    "2": { env: "local", run: "npm test -- two" },
    "1": { env: "local", run: "npm test -- one" },
  };
  assert.equal(
    signAcVerifications(AC_HASH, MAP, secret),
    signAcVerifications(AC_HASH, reordered, secret),
  );
  assert.equal(
    verifyAcSignature(
      AC_HASH,
      reordered,
      signAcVerifications(AC_HASH, MAP, secret),
      secret,
    ),
    true,
  );
});

test("fails verification under a wrong secret", () => {
  const secret = loadOrCreateSecret(tmpDir());
  const otherSecret = loadOrCreateSecret(tmpDir()); // a different random key file
  const sig = signAcVerifications(AC_HASH, MAP, secret);
  assert.equal(verifyAcSignature(AC_HASH, MAP, sig, otherSecret), false);
});

test("fails verification with an absent / empty / malformed signature", () => {
  const secret = loadOrCreateSecret(tmpDir());
  assert.equal(verifyAcSignature(AC_HASH, MAP, undefined, secret), false);
  assert.equal(verifyAcSignature(AC_HASH, MAP, "", secret), false);
  assert.equal(verifyAcSignature(AC_HASH, MAP, "not-hex-zz", secret), false);
  assert.equal(verifyAcSignature(AC_HASH, MAP, "abcd", secret), false); // wrong length
});

test("fails verification when the map or AC hash is tampered with", () => {
  const secret = loadOrCreateSecret(tmpDir());
  const sig = signAcVerifications(AC_HASH, MAP, secret);

  const tamperedMap: AcVerificationMap = {
    "1": { run: "rm -rf /", env: "local" },
    "2": { run: "npm test -- two", env: "local" },
  };
  assert.equal(verifyAcSignature(AC_HASH, tamperedMap, sig, secret), false);

  const otherHash = acRequirementHash(
    SPEC_BODY.replace("does the thing", "does a different thing"),
  );
  assert.notEqual(otherHash, AC_HASH);
  assert.equal(verifyAcSignature(otherHash, MAP, sig, secret), false);
});

test("signature is distinct from the reproducible acRequirementHash (AC2)", () => {
  const secret = loadOrCreateSecret(tmpDir());
  const sig = signAcVerifications(AC_HASH, MAP, secret);

  // The signature is not the AC hash itself...
  assert.notEqual(sig, AC_HASH);

  // ...and presenting the reproducible hash as if it were the signature does not verify — an agent
  // who can recompute `acRequirementHash` still cannot satisfy the gate without the server secret.
  assert.equal(verifyAcSignature(AC_HASH, MAP, AC_HASH, secret), false);
});

test("loadOrCreateSecret creates a persistent, owner-only key on first use", () => {
  const dir = tmpDir();
  const keyPath = path.join(dir, AC_SIGNING_KEY_FILE);
  assert.equal(fs.existsSync(keyPath), false);

  const first = loadOrCreateSecret(dir);
  assert.ok(Buffer.isBuffer(first));
  assert.ok(first.length >= 32);
  assert.equal(fs.existsSync(keyPath), true);

  // Owner-only permissions on POSIX (skip the bit check on platforms without it).
  if (process.platform !== "win32") {
    const mode = fs.statSync(keyPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  // Same bytes returned on a later call → a signature made earlier still verifies.
  const second = loadOrCreateSecret(dir);
  assert.deepEqual(second, first);
  const sig = signAcVerifications(AC_HASH, MAP, first);
  assert.equal(verifyAcSignature(AC_HASH, MAP, sig, second), true);
});

test("loadOrCreateSecret creates the storage directory if missing", () => {
  const dir = path.join(tmpDir(), "nested", "globalStorage");
  assert.equal(fs.existsSync(dir), false);
  const secret = loadOrCreateSecret(dir);
  assert.ok(secret.length >= 32);
  assert.equal(fs.existsSync(path.join(dir, AC_SIGNING_KEY_FILE)), true);
});

test("loadOrCreateSecret rejects a malformed key file", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, AC_SIGNING_KEY_FILE), "not-hex-data");
  assert.throws(() => loadOrCreateSecret(dir), /malformed/);
});

test("AC_SIGNATURE_KEY is a stable frontmatter field name", () => {
  // The sibling readyGate unit reads this exact key; pin it so a rename can't silently desync them.
  assert.equal(AC_SIGNATURE_KEY, "ac_verifications_signature");
});
