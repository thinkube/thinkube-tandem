// WHY (INVARIANT): an edited reason must never re-arm the minted token —
// editing the exemption reason on a signed cut changes tepContentHash, so
// tepApprovalOf reports the token no longer matches and dispatch refuses
// until the cut is signed again.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { signCut } from "../out-test/gates/sign.js";
import { tepContentHash, tepApprovalOf } from "../out-test/gates/approval.js";
import { loadOrCreateApprovalSecret, mintApproval } from "../out-test/engine/approvalToken.js";
import { createApprovalStore } from "../out-test/engine/approvalStore.js";

function baseSpace() {
  return {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "Add a widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "ac1", text: "widget renders" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  };
}

test("editing the exemption reason on a signed cut changes tepContentHash so tepApprovalOf reports mismatch", () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl3-ac5-keys-"));
  const secret = loadOrCreateApprovalSecret(storageDir);
  const approvals = createApprovalStore(storageDir);

  const space = baseSpace();
  const cut = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  };
  const signed = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const signedCut = { ...signed.cut, tepId: "TEP-t-1" };

  // The mint IS the click: the host hashes the just-signed cut and stores
  // the token exactly as signCutGesture does.
  const contentHash = tepContentHash(space, signedCut);
  approvals.put(`tep:${signedCut.tepId}`, mintApproval(`tep:${signedCut.tepId}`, contentHash, Date.now(), secret));

  const spaceWithCut = { ...space, cuts: [signedCut] };
  const before = tepApprovalOf(spaceWithCut, approvals, secret, signedCut.tepId);
  assert.equal(before.approved, true, "the freshly minted token must approve the unedited signed cut");

  const tamperedCut = {
    ...signedCut,
    docsExemption: { ...signedCut.docsExemption, reason: "a different reason typed in after the click" },
  };
  const spaceTampered = { ...space, cuts: [tamperedCut] };
  const after = tepApprovalOf(spaceTampered, approvals, secret, tamperedCut.tepId);
  assert.equal(after.approved, false, "an edited exemption reason must invalidate the minted approval");
});
