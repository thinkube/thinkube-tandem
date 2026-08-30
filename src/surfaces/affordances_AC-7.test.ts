/**
 * TRANSITION — missingPages is a new seam: the door proof now checks that
 * the page a door lives on actually renders, not only the control itself.
 *
 * This pins that a declared page whose handle is absent from the given
 * surface text comes back as missing, and that no page is reported missing
 * when every declared page's handle is present. Its job is done once
 * missingPages exists and is driven directly by surface text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingPages } from "./doors";
import { PAGES } from "./affordances";

test("missingPages returns a declared page whose handle is absent from the given surface text", () => {
  const missing = missingPages("<div>nothing declared appears here</div>");

  const declaredKeys = Object.values(PAGES).map((p) => p.handle);
  assert.ok(declaredKeys.length > 0, "set up: at least one page is declared");
  assert.ok(missing.length > 0, "at least one declared page is reported missing from empty surface text");
  for (const m of missing) assert.ok(declaredKeys.includes(m.handle), "every reported page is one PAGES declares");
});

test("missingPages returns nothing when every page handle is present", () => {
  const surfaceText = Object.values(PAGES)
    .map((p) => `<section ${p.handle}></section>`)
    .join("\n");

  const missing = missingPages(surfaceText);

  assert.deepEqual(missing, [], "every declared page's handle is present, so nothing is missing");
});
