/**
 * SP-6/17 (TEP-6) AC2 — the **exported** gate `assertSpecApprovedForSlicing(specId, specBody,
 * approvalDir)` always verifies against the store at its `approvalDir` argument: it **throws** when
 * the store holds no valid content-bound approval for the spec and **returns without throwing** when
 * the store holds a valid one. It has no early-return skip path and reads no env var to decide — its
 * decision tracks the `approvalDir` argument alone.
 *
 * Independence from the environment is proved directly: with a valid approval seeded in dir A and an
 * empty dir B, passing B still THROWS even while `THINKUBE_APPROVAL_DIR` points at A, and passing A
 * still RETURNS even with the env var unset — so the env cannot arm or disarm the gate.
 *
 * CONSUMES the approval contract — the exported gate (kanbanMcpServer.ts) plus `mintApproval` /
 * `loadOrCreateApprovalSecret` / `approvalContentHash` (approvalToken.ts) and `createApprovalStore`
 * (approvalStore.ts) — seeding a valid approval exactly as the host's Approve mint does, so a
 * contract drift in the token/hash/subjectKey shape fails the pass case here.
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { assertSpecApprovedForSlicing } from "../mcp/kanbanMcpServer";
import {
  approvalContentHash,
  loadOrCreateApprovalSecret,
  mintApproval,
} from "../services/approvalToken";
import { createApprovalStore } from "../services/approvalStore";

// Composite spec id `<tep>/<sp>` and the kind-namespaced subjectKey the gate derives from it.
const SPEC_ID = "1/1";
const SUBJECT = "spec:TEP-1/SP-1";
const BODY = "# Demo Spec\n\n## Acceptance Criteria\n\n- [ ] something\n";

const freshDir = (tag: string): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), `tk-sp17-ac2-${tag}-`));

/** Seed a VALID, content-bound approval into the store at `dir` — the SP-6/3 mint pattern the
 *  host's Approve button performs (secret loaded from the same dir, content hash over the body). */
function seedValidApproval(dir: string): void {
  const secret = loadOrCreateApprovalSecret(dir);
  const token = mintApproval(
    SUBJECT,
    approvalContentHash(BODY),
    Date.now(),
    secret,
  );
  createApprovalStore(dir).put(SUBJECT, token);
}

test("assertSpecApprovedForSlicing THROWS when the store holds no valid approval", () => {
  const empty = freshDir("empty");
  assert.throws(
    () => assertSpecApprovedForSlicing(SPEC_ID, BODY, empty),
    /approv/i,
    "an empty store must be refused, naming the missing approval",
  );
});

test("assertSpecApprovedForSlicing RETURNS when the store holds a valid content-bound approval", () => {
  const dir = freshDir("valid");
  seedValidApproval(dir);
  assert.doesNotThrow(
    () => assertSpecApprovedForSlicing(SPEC_ID, BODY, dir),
    "a valid, content-bound approval in the passed dir must clear the gate",
  );
});

test("the gate's decision tracks the approvalDir ARGUMENT, never the environment", () => {
  const good = freshDir("good");
  const empty = freshDir("nogood");
  seedValidApproval(good);

  const prev = process.env.THINKUBE_APPROVAL_DIR;
  try {
    // env points at the GOOD dir, but we pass the EMPTY dir → still refused: the env is ignored.
    process.env.THINKUBE_APPROVAL_DIR = good;
    assert.throws(
      () => assertSpecApprovedForSlicing(SPEC_ID, BODY, empty),
      /approv/i,
      "with the empty dir passed, a good env dir must NOT arm the gate",
    );

    // env unset, but we pass the GOOD dir → clears: the argument alone decides.
    delete process.env.THINKUBE_APPROVAL_DIR;
    assert.doesNotThrow(
      () => assertSpecApprovedForSlicing(SPEC_ID, BODY, good),
      "with the good dir passed, an unset env must NOT disarm the gate",
    );
  } finally {
    if (prev === undefined) delete process.env.THINKUBE_APPROVAL_DIR;
    else process.env.THINKUBE_APPROVAL_DIR = prev;
  }
});
