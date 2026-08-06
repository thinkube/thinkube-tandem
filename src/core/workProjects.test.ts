/**
 * Projects are WORK, not code: born named under a product, open until
 * marked done, holding a per-space context scope (the repositories the
 * thinking reads) that round-trips exactly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  createWorkProject,
  listWorkProjects,
  readContextScope,
  setWorkProjectState,
  writeContextScope,
} from "./workProjects";

test("a project is born open under its product; listing reads it back; done flips", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-wp-"));
  assert.equal(createWorkProject(root, "", "x").ok, false, "a product is required");
  assert.equal(createWorkProject(root, "Platform", "  ").ok, false, "a name is required");
  const made = createWorkProject(root, "Platform", "Plugin delivery", () => "abc123");
  assert.ok(made.ok);
  assert.equal(made.project.id, "plugin-delivery-abc123");
  const listed = listWorkProjects(root);
  assert.deepEqual(listed, [
    { id: "plugin-delivery-abc123", name: "Plugin delivery", product: "Platform", state: "open" },
  ]);
  assert.ok(setWorkProjectState(root, made.project.id, "done").ok);
  assert.equal(listWorkProjects(root)[0].state, "done");
  assert.equal(setWorkProjectState(root, "ghost", "done").ok, false, "unknown project refuses");
});

test("the context scope round-trips and deduplicates; absent reads empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-scope-"));
  assert.deepEqual(readContextScope(dir), []);
  writeContextScope(dir, ["repo-a", "repo-b", "repo-a"]);
  assert.deepEqual(readContextScope(dir), ["repo-a", "repo-b"]);
});
