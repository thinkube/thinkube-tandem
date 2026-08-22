/**
 * The minted-approval helpers: tepContentHash rebuilds a bare cut from
 * changeIds alone, carrying the cut's documentation exemption along so the
 * inner signCut it uses is not refused for missing documentation — and an
 * edited exemption reason moves the hash, invalidating a minted approval.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tepContentHash, tepApprovalOf } from "./approval";
import { signCut } from "./sign";
import { loadOrCreateApprovalSecret, mintApproval } from "../engine/approvalToken";
import { createApprovalStore } from "../engine/approvalStore";
import type { Space } from "../core/schema";

function baseSpace(): Space {
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
  } as unknown as Space;
}

test("tepContentHash for a cut carrying a documentation exemption hashes a non-empty grounding half, because the exemption rides onto the bare cut it rebuilds", () => {
  const space = baseSpace();
  const excused = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  };

  const excusedHash = tepContentHash(space, excused);
  assert.equal(typeof excusedHash, "string");
  assert.ok(excusedHash.length > 0, "the excused cut's content hash must be non-empty");

  // Directly confirm the grounding half tepContentHash folds in for this
  // cut is non-empty: signCut on the same bare "pair" cut — the exact
  // reconstruction tepContentHash itself performs — must succeed rather
  // than being refused for missing documentation. A refusal is exactly
  // what would hash an empty grounding half instead (tepContentHash's own
  // "" fallback when the inner signCut is not ok), so this proves the
  // exemption rode onto the cut tepContentHash rebuilds.
  const bareCut = { id: "pair", changeIds: excused.changeIds, docsExemption: excused.docsExemption };
  const innerSign = signCut(space, bareCut, "t", "x");
  assert.equal(
    innerSign.ok,
    true,
    "the bare cut tepContentHash rebuilds must carry the exemption, or its inner signCut is refused and hashes an empty grounding half",
  );
  if (innerSign.ok) {
    assert.ok(
      innerSign.cut.signature!.groundingHash.length > 0,
      "the grounding half tepContentHash folds in must be non-empty",
    );
  }
});

test("editing the exemption reason on a signed cut changes tepContentHash, so tepApprovalOf reports the minted token no longer matches", () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-approval-"));
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
  const before = tepApprovalOf(spaceWithCut, approvals, secret, signedCut.tepId!);
  assert.equal(before.approved, true, "the freshly minted token must approve the unedited signed cut");

  const tamperedCut = {
    ...signedCut,
    docsExemption: { ...signedCut.docsExemption, reason: "a different reason typed in after the click" },
  };
  const spaceTampered = { ...space, cuts: [tamperedCut] };
  const after = tepApprovalOf(spaceTampered, approvals, secret, tamperedCut.tepId!);
  assert.equal(after.approved, false, "an edited exemption reason must invalidate the minted approval, so dispatch refuses until the cut is signed again");
});
