/**
 * Unit tests for `specApprovalHash` — the mint-side body-extracting hasher (SP-6/19).
 * node:test + node:assert; run via `npm test`.
 *
 * What these tests pin (the exact agreement whose absence deadlocked slicing under SP-17):
 *   1. frontmatter-invariant — the same body under different `---`…`---` frontmatter fences
 *                              hashes identically: frontmatter is machinery and must never
 *                              invalidate an approval.
 *   2. body-sensitive        — any body edit moves the hash, re-arming the gate.
 *   3. fence-less = all-body — a raw with no leading fence is treated as all-body, i.e. it
 *                              hashes as `approvalContentHash` of the whole text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { specApprovalHash } from "./specApprovalHash";
import { approvalContentHash } from "./approvalToken";

const BODY = ["# Some Spec", "", "The reviewed body, byte-for-byte.", ""].join(
  "\n",
);

const EDITED_BODY = BODY.replace("byte-for-byte", "one character changed");

/** A synthetic raw spec file: a leading `---`…`---` frontmatter fence followed by the body. */
function rawDoc(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

test("specApprovalHash: same body, different frontmatter → same hash", () => {
  const fmA = "implements: TEP-6\nrepo: owner/name";
  const fmB =
    "implements: TEP-6\nrepo: owner/name\nstatus: ready\nac_signature: deadbeef";
  assert.equal(
    specApprovalHash(rawDoc(fmA, BODY)),
    specApprovalHash(rawDoc(fmB, BODY)),
  );
});

test("specApprovalHash: different body → different hash", () => {
  const fm = "implements: TEP-6";
  assert.notEqual(
    specApprovalHash(rawDoc(fm, BODY)),
    specApprovalHash(rawDoc(fm, EDITED_BODY)),
  );
});

test("specApprovalHash: a fence-less raw is hashed as all-body", () => {
  // No leading `---` fence → the whole text is the body: the hash equals
  // approvalContentHash(text) directly, and also equals hashing the same text
  // wrapped under any frontmatter fence.
  assert.equal(specApprovalHash(BODY), approvalContentHash(BODY));
  assert.equal(
    specApprovalHash(BODY),
    specApprovalHash(rawDoc("implements: TEP-6", BODY)),
  );
});
