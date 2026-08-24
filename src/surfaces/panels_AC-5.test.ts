/**
 * INVARIANT — a space with no name.txt must still get a legible tab title.
 * spaceLabel is the one place that decides the fallback, so this must
 * always return the directory slug when the space recorded no name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spaceLabel } from "../core/spaces";

test("spaceLabel returns the directory slug for a space that has no name.txt", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-spacelabel-"));
  const dir = path.join(storeRoot, "spaces", "repo-a", "unnamed-space");
  fs.mkdirSync(dir, { recursive: true });

  const label = spaceLabel(storeRoot, "repo-a", "unnamed-space");

  assert.equal(label, "unnamed-space");
});
