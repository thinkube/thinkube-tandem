// AC-11 (INVARIANT): a cut signed before the cut review carried a
// documentation line must be handled deliberately by verifyCutSignature —
// either it verifies clean under the old render, or its refusal names the
// documentation line as the cause and says re-signing settles it. It must
// never read only "the render changed since the signature", which would be
// an unexplained refusal to build for every cut signed before this feature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { addAsk, addNode } = require("../out/core/intent.js");
const { signCut, verifyCutSignature } = require("../out/gates/sign.js");
const { renderCutScreen } = require("../out/gates/render.js");
const { createHash } = require("node:crypto");

function sha(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "add a bulk-delete action to the list", "t");
  s = a.space;
  const r = addNode(s, {
    sentence: "selecting rows and pressing delete removes them all",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "selected rows are removed" }],
    grounding: { touchpoints: [{ path: "src/list/bulkDelete.ts" }], stamp: [] },
  });
  s = r.space;
  return { space: s, changeIds: [r.added.id] };
}

test("a cut signed under the pre-documentation render is handled deliberately, not as a bare render-drift refusal", () => {
  const { space, changeIds } = makeSpace();
  const cut = { id: "cut-1", changeIds };
  const signed = signCut(space, cut, "t1");
  assert.ok(signed.ok);

  // Simulate a signature minted under the OLD render (before the
  // documentation line existed on the cut review page) by rehashing a
  // render with the documentation line stripped out.
  const currentRender = renderCutScreen(space, cut);
  const preDocsRender = currentRender
    .split("\n")
    .filter((l) => !/documentation/i.test(l))
    .join("\n");
  const preDocsSignature = { ...signed.cut.signature, renderHash: sha(preDocsRender) };
  const preDocsCut = { ...signed.cut, signature: preDocsSignature };

  const v = verifyCutSignature(space, preDocsCut);
  if (v.ok) {
    // Tolerated: the pre-documentation signature verifies clean.
    assert.equal(v.ok, true);
  } else {
    // Named as a re-sign, not a bare "the render changed" message.
    assert.notEqual(
      v.reason.trim(),
      "the render changed since the signature",
      'the refusal must not read only "the render changed since the signature"',
    );
    assert.match(v.reason, /documentation/i, "the refusal names the documentation line as the cause");
    assert.match(v.reason, /re-?sign/i, "the refusal says re-signing settles it");
  }
});
