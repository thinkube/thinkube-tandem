/**
 * The sign-the-cut screen's documentation line: it always names where a
 * cut's documentation lands, or the human's own exemption reason word for
 * word, or that documentation is missing and blocks signing — and it never
 * prints the signing moment, so the reason alone hashes the same before
 * the click and after.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import type { Space } from "../core/schema";

function baseSpace(): Space {
  return {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "the widget resizes",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "c1", text: "it resizes", kind: "probe" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  } as unknown as Space;
}

test("renderCutScreen names the documentation pages a cut lands", () => {
  const space: Space = {
    ...baseSpace(),
    nodes: [
      {
        ...baseSpace().nodes[0],
        grounding: {
          touchpoints: [
            { path: "src/widget.ts" },
            { path: "docs/modules/ROOT/pages/widget.adoc" },
          ],
          stamp: [],
        },
      },
    ],
  } as unknown as Space;
  const cut = { id: "cut-1", changeIds: ["n1"] };
  const page = renderCutScreen(space, cut);
  assert.match(page, /docs\/modules\/ROOT\/pages\/widget\.adoc/);
});

test("renderCutScreen prints the exemption reason word for word when the cut carries one, and never the signing moment", () => {
  const space = baseSpace();
  const reason = "this is an internal refactor with no user-facing surface to document";
  const at = "2026-08-22T00:00:00.000Z";

  const cutSigned = { id: "cut-1", changeIds: ["n1"], docsExemption: { reason, at } };
  const page = renderCutScreen(space, cutSigned);
  assert.match(page, /documentation is not needed/i);
  assert.ok(page.includes(reason), "the render must carry the human's exemption reason word for word");
  assert.ok(!page.includes(at), "the render must not print the signing moment stamped on the exemption");

  // The same render, before any moment was ever stamped, must come out
  // byte-identical — the "at" field can never move the render's own text.
  const cutBeforeSigning = { id: "cut-1", changeIds: ["n1"], docsExemption: { reason } };
  const pageBeforeSigning = renderCutScreen(space, cutBeforeSigning);
  assert.equal(
    page,
    pageBeforeSigning,
    "the render must be identical whether or not the exemption carries a signing moment",
  );
});

test("renderCutScreen says documentation is missing and blocks signing when a cut lands none and carries no exemption", () => {
  const space = baseSpace();
  const cut = { id: "cut-1", changeIds: ["n1"] };
  const page = renderCutScreen(space, cut);
  assert.match(page, /documentation is missing/i);
  assert.match(page, /cannot be signed until it is written or excused/i);
});
