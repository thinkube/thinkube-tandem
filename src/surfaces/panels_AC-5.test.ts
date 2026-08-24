/**
 * A space's tab must be titled with the name the human actually typed when
 * they created it, not a shared generic label — spaceTitle reads that
 * recorded name (name.txt) for both a repository-owned space and a
 * "wp:" project-owned space.
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

// TRANSITION: spaceTitle is new in this slice — proves it resolves the
// human-typed name for a repository owner.
test("spaceTitle returns the recorded name for a repository owner", () => {
  const store = tmpStore();
  const dir = path.join(store, "spaces", "repo-1", "main");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name.txt"), "Main Thread\n");
  const title = spaceTitle(store, "repo-1", "main");
  assert.equal(title, "Main Thread");
});

// TRANSITION: same resolution must hold for a "wp:" project owner, whose
// spaces live under projects/ rather than spaces/.
test("spaceTitle returns the recorded name for a wp: project owner", () => {
  const store = tmpStore();
  const dir = path.join(store, "projects", "proj-1", "rebrand");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name.txt"), "Rebrand Effort\n");
  const title = spaceTitle(store, "wp:proj-1", "rebrand");
  assert.equal(title, "Rebrand Effort");
});
