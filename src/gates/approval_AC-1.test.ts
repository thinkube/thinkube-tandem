/**
 * Adding the Documentation line to the cut review redraws the page. That
 * is the page changing, not the promises — and it must not re-arm a gate
 * a person already signed and approved.
 *
 * The failure this guards: an approval minted over the RENDERED page stops
 * matching the moment the page gains a line, so a cut that was signed and
 * approved before this work refuses to dispatch afterwards. Worse, it
 * refuses with nowhere to go — see approval_AC-2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tepApprovalOf, tepContentHash } from "./approval";
import { signCut } from "./sign";
import { renderCutScreen } from "./render";
import { emptySpace, Space } from "../core/schema";
import { mintApproval, approvalContentHash, ApprovalToken } from "../engine/approvalToken";
import { ApprovalStore } from "../engine/approvalStore";

const SECRET = Buffer.from("a-test-secret");

/** An in-memory store — the disk one is not what this drives. */
function storeOf(entries: Record<string, ApprovalToken> = {}): ApprovalStore {
  const m = new Map(Object.entries(entries));
  return {
    put: (k, t) => void m.set(k, t),
    get: (k) => m.get(k),
  };
}

/**
 * A space with one grounded promise, signed into a cut carrying a tepId.
 *
 * The cut carries a not-needed reason because the docs duty refuses to
 * sign a cut that neither writes documentation nor says why it does not.
 * Without it the fixture cannot be signed at all and every drive below
 * dies in its own setup, never reaching the approval rule it exists to
 * prove. The waiver is part of the grounded half, so it is spelled here
 * once and carried into every hash this file mints.
 */
const WAIVER = { reason: "no user-facing change", at: "2026-08-22T00:00:00Z" };

function signedSpace(): { space: Space; tepId: string } {
  const base: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "greet the user",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const r = signCut(
    base,
    { id: "cut-1", changeIds: ["n1"], docsWaiver: WAIVER },
    "2026-08-22T00:00:00Z",
    "t",
    1,
  );
  assert.ok(r.ok, r.ok ? "" : r.reason);
  const tepId = r.cut.tepId!;
  return { space: { ...base, cuts: [r.cut] }, tepId };
}

// INVARIANT: an approval minted the OLD way — over the bytes of the
// rendered cut screen, as the gate did before this work — is still
// honoured after the page gains the Documentation line. The page's
// wording is nobody's signature; the grounded half did not move.
test("a cut approved against the review page as it read before this work still dispatches after the Documentation line is added", () => {
  const { space, tepId } = signedSpace();
  const cut = space.cuts[0];

  // The approval as it was minted then: hashed from the RENDERED page.
  const pageThen = renderCutScreen(space, cut) + "\n(no Documentation line yet)";
  const oldToken = mintApproval(`tep:${tepId}`, approvalContentHash(pageThen), 1, SECRET);

  // That page is not what the gate hashes now — otherwise this drive
  // proves nothing about a redraw.
  assert.notEqual(
    approvalContentHash(pageThen),
    tepContentHash(space, cut),
    "the gate still hashes the rendered page, so no redraw is being survived",
  );

  const verdict = tepApprovalOf(space, storeOf({ [`tep:${tepId}`]: oldToken }), SECRET, tepId);
  assert.deepEqual(verdict, { approved: true });
});

// INVARIANT: the escape hatch is not a hole. A cut whose grounded members
// actually moved still refuses, even though its old token also mismatches.
test("a cut whose promises moved after approval is still refused", () => {
  const { space, tepId } = signedSpace();
  const pageThen = renderCutScreen(space, space.cuts[0]);
  const oldToken = mintApproval(`tep:${tepId}`, approvalContentHash(pageThen), 1, SECRET);

  // The promise now lands somewhere else: that is drift, not a redraw.
  const drifted: Space = {
    ...space,
    nodes: space.nodes.map((n) => ({
      ...n,
      grounding: { touchpoints: [{ path: "src/other.ts", planned: true }], stamp: [] },
    })),
  };
  const verdict = tepApprovalOf(drifted, storeOf({ [`tep:${tepId}`]: oldToken }), SECRET, tepId);
  assert.equal(verdict.approved, false, "a promise that moved must not be waved through");
});

// INVARIANT: nothing unsigned rides the escape hatch. A token forged under
// another secret fails its HMAC and is refused whatever the signature says.
test("an approval forged under another secret is refused even when the signature verifies", () => {
  const { space, tepId } = signedSpace();
  const forged = mintApproval(
    `tep:${tepId}`,
    tepContentHash(space, space.cuts[0]),
    1,
    Buffer.from("not-the-secret"),
  );
  const verdict = tepApprovalOf(space, storeOf({ [`tep:${tepId}`]: forged }), SECRET, tepId);
  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, "bad-signature");
});
