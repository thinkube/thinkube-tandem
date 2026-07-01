/**
 * ThinkubeStore.resolveOrgRelativePath — a caller may address the org tree by a
 * bare `teps/…` path without knowing the maintainer's org segment; the store
 * rewrites it to `<org>/teps/…`. This is what lets `get_thinkube_file
 * "teps/TEP-6/SP-3/spec.md"` resolve instead of dropping the org and 404-ing
 * (the skill guidance the drop kept breaking). installVscodeStub first — the
 * store imports `vscode`.
 */
import "./installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "../store/ThinkubeStore";

/** A thinking space dir whose org segment (`cmxela`) holds the `teps/` tree. */
function orgTreeStore(): ThinkubeStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-orgrel-"));
  fs.mkdirSync(path.join(dir, "cmxela", "teps", "TEP-6", "SP-3"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(dir, "cmxela", "teps", "TEP-6", "SP-3", "spec.md"),
    "# spec\n",
  );
  return new ThinkubeStore(dir, dir);
}

test("a bare teps/… path is rewritten under the discovered org segment", () => {
  const store = orgTreeStore();
  assert.equal(
    store.resolveOrgRelativePath("teps/TEP-6/SP-3/spec.md"),
    "cmxela/teps/TEP-6/SP-3/spec.md",
  );
  // A leading slash is tolerated.
  assert.equal(
    store.resolveOrgRelativePath("/teps/TEP-6/SP-3/spec.md"),
    "cmxela/teps/TEP-6/SP-3/spec.md",
  );
});

test("a path already carrying the org, or a non-org dir, passes through unchanged", () => {
  const store = orgTreeStore();
  assert.equal(
    store.resolveOrgRelativePath("cmxela/teps/TEP-6/SP-3/spec.md"),
    "cmxela/teps/TEP-6/SP-3/spec.md",
  );
  assert.equal(store.resolveOrgRelativePath("specs/SP-50.md"), "specs/SP-50.md");
});

test("getFile resolves the bare org-relative path end to end", async () => {
  const store = orgTreeStore();
  const parsed = await store.getFile(
    store.resolveOrgRelativePath("teps/TEP-6/SP-3/spec.md"),
  );
  assert.ok(parsed, "spec should be found via the org-rewritten path");
});

test("an org-less thinking space returns the path untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-orgless-"));
  const store = new ThinkubeStore(dir, dir);
  assert.equal(
    store.resolveOrgRelativePath("teps/TEP-1/tep.md"),
    "teps/TEP-1/tep.md",
  );
});
