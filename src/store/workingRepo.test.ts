/**
 * workingRepoPath / specRepoNamespace (TEP-5): a Spec's working repo comes from
 * its `repo:` frontmatter; a normal Spec falls back to the thinking space repo, and a
 * SET-but-unresolvable `repo:` throws rather than silently using the wrong repo.
 * installVscodeStub first (the helpers touch ThinkubeStore + the vscode shim).
 */
import "../mcp/installVscodeStub";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ThinkubeStore } from "./ThinkubeStore";
import { workingRepoPath, specRepoNamespace } from "./workingRepo";

const AC = "\n\n## Acceptance Criteria\n\n- [ ] x\n";

test("specRepoNamespace: the repo: ns, or undefined for a normal spec", async () => {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-wrepo-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc("1/1"),
    { repo: "Platform/core/thinkube-metadata" },
    `# a${AC}`,
  );
  await store.writeFile(store.pathForSpecDoc("1/2"), {}, `# b${AC}`);
  assert.equal(
    await specRepoNamespace(store, "1/1"),
    "Platform/core/thinkube-metadata",
  );
  assert.equal(await specRepoNamespace(store, "1/2"), undefined);
});

test("workingRepoPath: no repo: → the fallback (the thinking space's own repo)", async () => {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-wrepo2-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(store.pathForSpecDoc("1/1"), {}, `# a${AC}`);
  assert.equal(
    await workingRepoPath(store, "1/1", "/fallback/repo"),
    "/fallback/repo",
  );
});

test("workingRepoPath: repo: SET but no thinking-space root configured → THROWS (no silent fallback)", async () => {
  const thinkingSpace = fs.mkdtempSync(path.join(os.tmpdir(), "tk-wrepo3-"));
  const store = new ThinkubeStore(thinkingSpace, thinkingSpace);
  await store.writeFile(
    store.pathForSpecDoc("1/1"),
    { repo: "Platform/core/does-not-exist" },
    `# a${AC}`,
  );
  // ENFORCEMENT (TEP-14): with a `repo:` present, resolution is verified
  // against the declared space card — without a configured root there is no
  // card to verify against, so it refuses. Never a guess, never the fallback.
  await assert.rejects(
    () => workingRepoPath(store, "1/1", "/fallback/repo"),
    /no thinking-space root is configured/,
  );
});
