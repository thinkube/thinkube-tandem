/**
 * spaceRegistry — cards on disk: discovery listing, declared-orgs
 * enforcement, and verified working-repo resolution (the filesystem copy is
 * the authority: exists + is a git repository).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readSpaceCard,
  listDeclaredSpaces,
  assertDeclaredOrgs,
  assertDeclaredSpace,
  resolveVerifiedRepo,
} from "./spaceRegistry";

function tmpTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-space-reg-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}

test("listDeclaredSpaces returns root-relative names of card-bearing dirs, sorted", () => {
  const root = tmpTree({
    "Platform/core/thinkube-control/space.yaml": "orgs: [cmxela]\n",
    "Platform/projects/rebrand/space.yaml": "orgs: [cmxela]\n",
    "Platform/stray-dir/README.md": "not a space",
  });
  assert.deepEqual(listDeclaredSpaces(root), [
    "Platform/core/thinkube-control",
    "Platform/projects/rebrand",
  ]);
});

test("readSpaceCard: present parses; absent is undefined", () => {
  const root = tmpTree({ "s/space.yaml": "orgs: [cmxela]\n" });
  assert.deepEqual(readSpaceCard(path.join(root, "s")), { orgs: ["cmxela"] });
  assert.equal(readSpaceCard(path.join(root, "nope")), undefined);
});

test("an undeclared maintainer subtree refuses loudly", () => {
  const root = tmpTree({
    "s/space.yaml": "orgs: [cmxela]\n",
    "s/cmxela/teps/.gitkeep": "",
    "s/intruder/teps/.gitkeep": "",
  });
  const dir = path.join(root, "s");
  assert.throws(
    () => assertDeclaredOrgs(readSpaceCard(dir)!, dir),
    /"intruder\/".*not.*declared/s,
  );
});

test("assertDeclaredSpace: undeclared name refuses listing declared spaces", () => {
  const root = tmpTree({
    "Platform/core/thinkube-control/space.yaml": "orgs: []\n",
  });
  assert.deepEqual(
    assertDeclaredSpace("Platform/core/thinkube-control", root, "test"),
    { orgs: [] },
  );
  assert.throws(
    () => assertDeclaredSpace("Platform/core/nope", root, "test"),
    /not a declared thinking space.*Declared spaces: Platform\/core\/thinkube-control/s,
  );
});

test("resolveVerifiedRepo: declared + resolvable + a real git repo → path; each miss refuses with its reason", () => {
  const home = tmpTree({
    "platform-dir/core/thing/.git/HEAD": "ref: refs/heads/main\n",
    "platform-dir/core/no-git/README.md": "",
  });
  const root = tmpTree({
    "Platform/core/thing/space.yaml": "orgs: []\n",
    "Platform/core/no-git/space.yaml": "orgs: []\n",
    "Platform/core/gone/space.yaml": "orgs: []\n",
  });
  const folders = [{ name: "Platform", path: path.join(home, "platform-dir") }];

  assert.equal(
    resolveVerifiedRepo("Platform/core/thing", folders, root, "t"),
    path.join(home, "platform-dir", "core", "thing"),
  );
  assert.throws(
    () => resolveVerifiedRepo("Platform/core/no-git", folders, root, "t"),
    /not a git repository/,
  );
  assert.throws(
    () => resolveVerifiedRepo("Platform/core/gone", folders, root, "t"),
    /does not exist/,
  );
  assert.throws(
    () => resolveVerifiedRepo("Platform/core/undeclared", folders, root, "t"),
    /not a declared thinking space/,
  );
});
