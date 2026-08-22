/**
 * The two signatures: signing binds a cut's render and grounding, and
 * documentation is part of that gate — a cut lands documentation or
 * carries a written exemption, never neither.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut, verifyCutSignature } from "./sign";
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

function spaceWithDocs(): Space {
  const s = baseSpace();
  return {
    ...s,
    nodes: [
      ...s.nodes,
      {
        id: "n2",
        sentence: "Document the widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "docs/modules/ROOT/pages/widget.adoc" }], stamp: [] },
        acceptance: [{ id: "ac2", text: "the doc page exists" }],
      },
    ],
  } as unknown as Space;
}

test("signCut refuses a cut whose members ground no documentation path and carries no exemption, saying documentation is missing", () => {
  const space = baseSpace();
  const cut = { id: "c1", changeIds: ["n1"] };
  const result = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason.toLowerCase(), /documentation/);
    assert.match(result.reason.toLowerCase(), /missing/);
  }
});

test("signCut signs a cut once one member's grounding lands a documentation path", () => {
  const space = spaceWithDocs();
  const cut = { id: "c1", changeIds: ["n1", "n2"] };
  const result = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(result.ok, true);
});

test("signCut signs a cut that lands no documentation when the cut carries an exemption with a non-empty reason, and stamps that reason with the signing moment", () => {
  const space = baseSpace();
  const reason = "this cut only touches internal tooling, no user-facing surface changed";
  const at = "2026-08-22T00:00:00.000Z";
  const cut = { id: "c1", changeIds: ["n1"], docsExemption: { reason } };
  const result = signCut(space, cut, at);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.cut.docsExemption?.reason, reason, "the reason must ride onto the signed cut word for word");
    assert.equal((result.cut.docsExemption as { at?: string })?.at, at, "the signed cut must carry the moment it was signed");
  }
});

test("signCut refuses an undocumented, unexempted cut the same way regardless of docsGateMode, which governs the accept gate only", () => {
  const space = baseSpace();
  const cut = { id: "c1", changeIds: ["n1"] };
  // The setting governs the accept gate, so signCut has no channel to be
  // told it: there is no mode parameter, and no mode field is read off the
  // space. Refusal therefore cannot vary with it — which is the criterion.
  assert.ok(
    signCut.length <= 5,
    "signCut must take no docsGateMode parameter — the setting is the accept gate's, not the sign gate's",
  );
  const strict = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  const advisory = signCut(
    { ...space, docsGateMode: "advisory" } as unknown as Space,
    cut,
    "2026-08-22T00:00:00.000Z",
  );
  assert.equal(strict.ok, false);
  assert.equal(advisory.ok, false);
  if (strict.ok === false && advisory.ok === false) {
    assert.equal(strict.reason, advisory.reason);
    assert.match(strict.reason.toLowerCase(), /documentation/);
    assert.match(strict.reason.toLowerCase(), /accept/);
  }
});

test("verifyCutSignature reports grounding drift when the exemption reason on a signed cut is edited afterwards", () => {
  const space = baseSpace();
  const cut = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  };
  const signed = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(signed.ok, true);
  if (!signed.ok) return;

  const tampered = {
    ...signed.cut,
    docsExemption: { ...signed.cut.docsExemption, reason: "a different reason typed in after the click" },
  };
  const verdict = verifyCutSignature(space, tampered);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.drift, "grounding");
});

test("verifyCutSignature returns ok on the cut signCut just returned when it carries a documentation exemption", () => {
  const space = baseSpace();
  const cut = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  };
  const signed = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(signed.ok, true);
  if (!signed.ok) return;

  const verdict = verifyCutSignature(space, signed.cut);
  assert.equal(verdict.ok, true, "the freshly signed excused cut must verify clean, with no drift");
});
