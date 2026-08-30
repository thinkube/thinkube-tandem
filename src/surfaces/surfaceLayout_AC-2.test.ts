/**
 * INVARIANT — everything above the tab row is the same for every page.
 *
 * The regions listed before "tabs" are what always renders above the row
 * (the "Asking in" header and anything else page-independent). If any
 * page inserted its own region ahead of tabs, the row would stop sitting
 * in a fixed place. This is a standing rule of the layout, checked for
 * as long as surfaceRegions exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceRegions, SurfacePage } from "./surfaceLayout";

const PAGES: SurfacePage[] = ["write", "intent", "work", "flow"];

test("the regions before tabs are the same list for every page", () => {
  const before = PAGES.map((page) => {
    const regions = surfaceRegions(page);
    const i = regions.indexOf("tabs");
    return regions.slice(0, i);
  });

  for (let i = 1; i < before.length; i++) {
    assert.deepEqual(
      before[i],
      before[0],
      `page ${PAGES[i]} has a different set of regions above tabs than page ${PAGES[0]}`,
    );
  }
});
