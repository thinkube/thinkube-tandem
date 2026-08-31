/**
 * INVARIANT — exactly one page in the shared surface contract draws the
 * ask list. The contract names that page once, as ASKS_PAGE, so the
 * surface and its checks read the same fact from one place instead of
 * each deciding page by page which page shows the asks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {ASKS_PAGE, drawsAskList, SurfacePage, } from "./surfaceContract";
import { SURFACE_PAGES } from "./surfaceLayout";

test("exactly one page in SURFACE_PAGES satisfies drawsAskList, and it is ASKS_PAGE", () => {
  const askPages: SurfacePage[] = SURFACE_PAGES.filter((page) =>
    drawsAskList(page),
  );

  assert.equal(
    askPages.length,
    1,
    "more than one page (or no page) claims to draw the ask list: " +
      JSON.stringify(askPages),
  );
  assert.equal(
    askPages[0],
    ASKS_PAGE,
    "the one page that draws the ask list must be ASKS_PAGE",
  );
});

test("drawsAskList(ASKS_PAGE) is true", () => {
  assert.equal(
    drawsAskList(ASKS_PAGE),
    true,
    "ASKS_PAGE itself must satisfy drawsAskList",
  );
});

test("ASKS_PAGE is one of the pages listed in SURFACE_PAGES", () => {
  assert.ok(
    SURFACE_PAGES.includes(ASKS_PAGE),
    "ASKS_PAGE must be a member of SURFACE_PAGES",
  );
});
