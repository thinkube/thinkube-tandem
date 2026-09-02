/**
 * INVARIANT — the notice sits at the same position for every page.
 *
 * The line a refused press speaks on must never drift up or down as the
 * page changes, or its height would depend on which page is showing.
 * This holds for as long as surfaceRegions exists: it is not a one-time
 * migration check, it is the rule the layout must keep honouring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceRegions, SurfacePage } from "./surfaceLayout";

const PAGES: SurfacePage[] = ["write", "intent", "work", "flow"];

test("the notice sits at the same index for every page", () => {
  const indices = PAGES.map((page) => surfaceRegions(page).indexOf("notice"));

  assert.ok(
    indices.every((i) => i !== -1),
    "every page's region list names the notice at all",
  );
  assert.ok(
    indices.every((i) => i === indices[0]),
    "the notice is not at the same index for every page: " + JSON.stringify(indices),
  );
});
