/**
 * INVARIANT — a space's tab is titled with the human's own words whenever
 * they recorded one: spaceTitle must return the space's name.txt verbatim,
 * never a re-derived or reformatted version of it, so the recorded name
 * always wins over any fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spaceTitle } from "./spaceOps";

test("spaceTitle returns the recorded name verbatim when name.txt holds one", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac1-"));
  const dir = path.join(storeRoot, "spaces", "repo1", "docs-duty-and-tabs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name.txt"), "Docs Duty & Tabs\n");

  const title = spaceTitle(storeRoot, "repo1", "docs-duty-and-tabs");

  assert.equal(title, "Docs Duty & Tabs", "the recorded name is returned byte for byte, not reformatted");
});
