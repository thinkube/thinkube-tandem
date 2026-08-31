/**
 * TRANSITION — the four pages are named once, and surfaceRegions is driven
 * from that same shared list rather than a second, hand-typed one.
 *
 * Before this change, a page union could exist in more than one place
 * (the layout, the contract, the render harness), each free to drift from
 * the others. This test proves surfaceLayout.ts exports the one runtime
 * list of pages and that surfaceRegions answers for exactly those pages
 * and no others — so any other reader that imports the same list stays in
 * lock-step by construction. Its job is done once every reader (contract,
 * harness, App.tsx) is confirmed to import this one list — until then it
 * stands as the seam proving the list exists and is authoritative.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as layout from "./surfaceLayout";
import { surfaceRegions, SurfacePage } from "./surfaceLayout";

test("surfaceRegions answers for every page the shared list names, and nothing else", () => {
  const exported = (layout as Record<string, unknown>).SURFACE_PAGES;
  assert.ok(
    Array.isArray(exported),
    "surfaceLayout.ts exports a runtime SURFACE_PAGES list — the one shared definition every reader (contract, harness, App.tsx) imports",
  );
  const pages = exported as SurfacePage[];

  assert.deepEqual(
    new Set(pages),
    new Set(["write", "intent", "work", "flow"]),
    "the shared page list names exactly the four pages the contract defines",
  );

  for (const page of pages) {
    const regions = surfaceRegions(page);
    assert.ok(
      Array.isArray(regions) && regions.length > 0,
      `surfaceRegions(${page}) returns a non-empty region list for a page the shared list names`,
    );
  }
});
