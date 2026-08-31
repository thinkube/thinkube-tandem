/**
 * INVARIANT — the tab row sits at the same position for every page.
 *
 * The row of pages ("tabs") must never drift up or down as the reader
 * switches pages, or its height would depend on which page is showing.
 * This holds for as long as surfaceRegions exists: it is not a one-time
 * migration check, it is the rule the layout must keep honouring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceRegions, SurfacePage } from "./surfaceLayout";

const PAGES: SurfacePage[] = ["write", "intent", "work", "flow"];

test("tabs sits at the same index for every page", () => {
  const indices = PAGES.map((page) => surfaceRegions(page).indexOf("tabs"));

  assert.ok(
    indices.every((i) => i !== -1),
    "every page's region list names tabs at all",
  );
  assert.ok(
    indices.every((i) => i === indices[0]),
    "tabs is not at the same index for every page: " + JSON.stringify(indices),
  );
});
