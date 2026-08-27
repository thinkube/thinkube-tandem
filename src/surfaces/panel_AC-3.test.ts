/**
 * INVARIANT — a space's title is the human-chosen name it was given, read
 * from its name.txt, and falls back to the directory slug only when no
 * name was ever recorded. This must always hold: it is what lets a panel's
 * title be the space's own name (AC-1) instead of a fixed product name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spaceTitle } from "../hostui/spaceOps";

function storeWithSpace(slug: string, name?: string): string {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-spacetitle-"));
  const dir = path.join(storeRoot, "spaces", "owner-1", slug);
  fs.mkdirSync(dir, { recursive: true });
  if (name !== undefined) fs.writeFileSync(path.join(dir, "name.txt"), `${name}\n`);
  return storeRoot;
}

test("spaceTitle() returns the name written in the space's name.txt", () => {
  const storeRoot = storeWithSpace("plugin-delivery", "plugin delivery");
  assert.equal(spaceTitle(storeRoot, "owner-1", "plugin-delivery"), "plugin delivery");
});

test("spaceTitle() falls back to the directory slug when there is no name.txt", () => {
  const storeRoot = storeWithSpace("plugin-delivery");
  assert.equal(spaceTitle(storeRoot, "owner-1", "plugin-delivery"), "plugin-delivery");
});
