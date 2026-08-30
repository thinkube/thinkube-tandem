/**
 * TRANSITION — the region list now names the rail, so a page drawn from
 * the region order can never leave out the one place a parked worker's
 * question is answered.
 *
 * Before this change the rail was a stray sibling rendered after the page,
 * named by no region — so nothing checked it was ever drawn at all. This
 * pins that "rail" appears in every page's region list, exactly once, at
 * the same index for every page. Its job is done once App.tsx is
 * confirmed to draw the rail from this list rather than as a block
 * outside it — the shape of the list itself then holds as an invariant.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceRegions, SurfacePage } from "./surfaceLayout";

const PAGES: SurfacePage[] = ["write", "intent", "work", "flow"];

test("the rail appears exactly once, at the same index, in every page's region list", () => {
  const perPage = PAGES.map((page) => surfaceRegions(page));

  for (const [i, regions] of perPage.entries()) {
    const count = regions.filter((r) => r === "rail").length;
    assert.equal(count, 1, `page ${PAGES[i]} names "rail" exactly once, got ${count}`);
  }

  const indices = perPage.map((regions) => regions.indexOf("rail"));
  assert.ok(
    indices.every((idx) => idx === indices[0]),
    "the rail is not at the same index for every page: " + JSON.stringify(indices),
  );
});
