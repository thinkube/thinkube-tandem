/**
 * When a run is refused for an approval that no longer matches, the
 * refusal must send the person somewhere that works.
 *
 * The failure this guards: telling a person to "sign it again" for
 * promises already in a signed work order. The sign gate refuses exactly
 * that, so the advice cannot be taken — the run is stranded with no
 * gesture that recovers it. The gesture that DOES exist is "think again",
 * which withdraws the signed cut and releases its promises to be derived
 * and signed anew.
 *
 * Driven against the sign gate itself rather than against a spelled
 * string: a refusal is only a way out if the gate it names accepts it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "./sign";
import { whyRefused } from "../surfaces/runGate";
import { emptySpace, Space } from "../core/schema";

function spaceWithPromise(): Space {
  return {
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
}

// INVARIANT: the sign gate really does refuse promises already in a
// signed work order. This is the premise the refusal wording depends on;
// if it ever stops holding, the wording below should be revisited.
test("the sign gate refuses to sign promises already in a signed work order", () => {
  const base = spaceWithPromise();
  const first = signCut(
    base,
    { id: "cut-1", changeIds: ["n1"], docsWaiver: { reason: "no docs", at: "2026-08-22T00:00:00Z" } },
    "2026-08-22T00:00:00Z",
    "t",
    1,
  );
  assert.ok(first.ok, first.ok ? "" : first.reason);

  const again = signCut(
    { ...base, cuts: [first.cut] },
    { id: "cut-2", changeIds: ["n1"], docsWaiver: { reason: "no docs", at: "2026-08-22T00:00:00Z" } },
    "2026-08-22T00:00:00Z",
    "t",
    2,
  );
  assert.equal(again.ok, false, "signing the same promise twice must be refused");
  assert.match(again.ok ? "" : again.reason, /already in a signed work order/);
});

// INVARIANT: no refusal for a mismatched approval tells the person to sign
// again — that is the advice the gate above cannot accept. Every such
// refusal points at "think again", which withdraws the signed cut.
test("a refusal for a mismatched approval names think-again, never a re-sign the gate would refuse", () => {
  for (const reason of ["content-mismatch", "subject-mismatch", "bad-signature"]) {
    const said = whyRefused(reason);
    assert.match(
      said,
      /Think it through again/i,
      `"${reason}" does not offer the gesture that recovers a signed cut`,
    );
    assert.doesNotMatch(
      said,
      /\bsign it again\b/i,
      `"${reason}" tells the person to sign again, which the sign gate refuses for signed promises`,
    );
  }
});

// INVARIANT: the internal name never reaches the person. "content-mismatch"
// is the token machinery's word for itself, and the person is never asked
// about internals.
test("a refusal never repeats the token machinery's own words back to the person", () => {
  for (const reason of ["content-mismatch", "subject-mismatch", "bad-signature", "unsigned"]) {
    assert.doesNotMatch(whyRefused(reason), /content-mismatch|subject-mismatch|bad-signature/);
  }
});
