/**
 * INVARIANT — a space's tab must be titled with the name a person actually
 * gave it. spaceLabel is the one place that reads that name back, so this
 * must always return what is written in the space's name.txt, not its
 * directory slug, whenever that file exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spaceLabel } from "../core/spaces";

test("spaceLabel returns the name a person wrote in the space's name.txt", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-spacelabel-"));
  const dir = path.join(storeRoot, "spaces", "repo-a", "deep-dive");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name.txt"), "Deep Dive\n");

  const label = spaceLabel(storeRoot, "repo-a", "deep-dive");

  assert.equal(label, "Deep Dive");
});
