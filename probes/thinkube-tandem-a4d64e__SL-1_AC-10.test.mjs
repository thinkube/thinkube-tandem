// WHY (INVARIANT): editing a grounded member of a signed, waived cut must
// make the minted approval stop matching, so dispatch refuses until the
// human signs again — a waived cut is bound exactly as tightly as a
// documented one, not more loosely.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { tepContentHash } from "../src/gates/approval.ts";
import { mintApproval, approvalStatus } from "../src/engine/approvalToken.ts";

test("editing a grounded member after a waived signature invalidates the approval", () => {
  let s = emptySpace();
  const a = addAsk(s, "add an undocumented thing", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a promise nowhere documented",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  assert.ok(n.ok);
  s = n.space;

  const cut = {
    changeIds: [n.added.id],
    tepId: "TEP-t-1",
    docs: { waived: true, reason: "internal-only, no user surface" },
  };
  const secret = Buffer.from("test-secret-32-bytes-long-buffer");
  const contentHashAtSign = tepContentHash(s, cut);
  const token = mintApproval(`tep:${cut.tepId}`, contentHashAtSign, 1_000, secret);

  // The approval matches the state at the moment of signing.
  const before = approvalStatus(token, {
    subjectKey: `tep:${cut.tepId}`,
    contentHash: contentHashAtSign,
    secret,
  });
  assert.equal(before.ok, true, "sanity: the freshly minted token matches its own content hash");

  // Now a grounded member changes — the touchpoint moves.
  const edited = {
    ...s,
    nodes: s.nodes.map((node) =>
      node.id === n.added.id
        ? { ...node, grounding: { touchpoints: [{ path: "src/thing-renamed.ts" }], stamp: [] } }
        : node,
    ),
  };
  const contentHashAfterEdit = tepContentHash(edited, cut);
  assert.notEqual(contentHashAfterEdit, contentHashAtSign, "editing a grounded member moves the content hash");

  const after = approvalStatus(token, {
    subjectKey: `tep:${cut.tepId}`,
    contentHash: contentHashAfterEdit,
    secret,
  });
  assert.equal(after.ok, false, "dispatch refuses: the approval no longer matches the edited cut");
  assert.equal(after.reason, "content-mismatch");
});
