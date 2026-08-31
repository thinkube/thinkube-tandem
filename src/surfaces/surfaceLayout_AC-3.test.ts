/**
 * INVARIANT — the tab row is drawn exactly once per page.
 *
 * Nothing in the layout should ever list "tabs" twice for one page — that
 * would mean two rows fighting for the same fixed position, or a region
 * list built by accidentally concatenating overlapping pieces. Holds for
 * as long as surfaceRegions exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceRegions, SurfacePage } from "./surfaceLayout";

const PAGES: SurfacePage[] = ["write", "intent", "work", "flow"];

test("every page's region list contains tabs exactly once", () => {
  for (const page of PAGES) {
    const count = surfaceRegions(page).filter((r) => r === "tabs").length;
    assert.equal(count, 1, `page ${page} lists tabs ${count} times, expected exactly once`);
  }
});
