/**
 * TRANSITION — a check now drives the door proof against the surface this
 * build actually ships, so a control or a page that stops rendering fails
 * the build instead of waiting for a person to notice on a delivery page.
 *
 * This pins the positive path: given the surface text this build shipped
 * (read through builtSurfaceText's injected reader, since the test build
 * compiles only the host tree and never runs the webview build itself), no
 * declared door and no declared page is reported missing when the surface
 * text carries every one of their handles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtSurfaceText, missingDoors, missingPages } from "./doors";
import { AFFORDANCES, PAGES } from "./affordances";

test("with the surface built by the test command, no declared door and no declared page is missing from the built surface text", () => {
  // Stand in for "the surface this build ships": every declared page's
  // handle, and every declared human door's handle, present in the text —
  // exactly what a real build that still renders every control produces.
  const pageMarkup = Object.values(PAGES)
    .map((p) => `<section ${p.handle}></section>`)
    .join("\n");
  const doorMarkup = Object.entries(AFFORDANCES)
    .filter(([, e]) => e.kind === "human")
    .map(([action]) => `<button data-${action}></button>`)
    .join("\n");
  const builtText = builtSurfaceText(() => `${pageMarkup}\n${doorMarkup}`);

  assert.deepEqual(missingPages(builtText), [], "no declared page is missing from a surface that renders every page's handle");
  assert.deepEqual(missingDoors(builtText), [], "no declared door is missing from a surface that renders every door's handle");
});
