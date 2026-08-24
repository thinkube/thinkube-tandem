/**
 * When a space directory has no recorded name (no name.txt, or an empty
 * one), the tab must still get a legible title — falling back to the slug
 * rather than showing nothing or throwing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spaceTitle } from "../hostui/spaceOps";

function tmpStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panels-"));
}

// INVARIANT: no name.txt on disk falls back to the slug — always holds,
// for any space whose name was never recorded.
test("spaceTitle falls back to the slug when no name.txt exists", () => {
  const store = tmpStore();
  const dir = path.join(store, "spaces", "repo-1", "plugin-delivery");
  fs.mkdirSync(dir, { recursive: true });
  const title = spaceTitle(store, "repo-1", "plugin-delivery");
  assert.equal(title, "plugin-delivery");
});
