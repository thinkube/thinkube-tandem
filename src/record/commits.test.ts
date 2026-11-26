/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What was implemented is read from the repository: the commits that
 * touched the module's files since the record last looked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileNewCommits, startLooking } from "./commits";
import { appendRow, moduleHome, readRows } from "./journal";
import { clockFrom, commit, repoWith, tmp } from "./repo.fixture";

const CONTROL = {
  "thinkube.yaml": "kind: ThinkubeDeployment\n",
  "backend/app.py": "\n",
  "extensions/forge/thinkube.yaml": "kind: ThinkubeDeployment\n",
  "extensions/forge/backend/runs.py": "\n",
};

function looking(prefix: string) {
  const gitRoot = repoWith(CONTROL);
  const where = {
    storeRoot: tmp("store"),
    author: "ana",
    session: "s-1",
    module: { id: "m-1", gitRoot, prefix },
    now: clockFrom("2026-03-01T10:00:00.000Z"),
  };
  startLooking(where);
  return where;
}

const commitsFiled = (w: { storeRoot: string }) =>
  readRows(w.storeRoot, "m-1").flatMap((r) => (r.kind === "commit" ? [r] : []));

test("commits made before the record began are not claimed", () => {
  const w = looking("extensions/forge");
  assert.deepEqual(fileNewCommits(w), { filed: 0 });
  assert.deepEqual(commitsFiled(w), []);
});

test("a commit is filed in the module whose files it changed, with those files only", () => {
  const w = looking("extensions/forge");
  commit(w.module.gitRoot, { "backend/app.py": "core\n" }, "Core only");
  const both = commit(
    w.module.gitRoot,
    { "backend/app.py": "core 2\n", "extensions/forge/backend/runs.py": "forge\n" },
    "Core and Forge",
  );

  assert.equal(fileNewCommits(w).filed, 1);
  const [row] = commitsFiled(w);
  assert.equal(row.sha, both);
  assert.equal(row.subject, "Core and Forge");
  assert.equal(row.committer, "Tester");
  assert.deepEqual(row.files, ["extensions/forge/backend/runs.py"]);
});

test("the root module does not own what a module inside it owns", () => {
  const w = looking("");
  commit(w.module.gitRoot, { "extensions/forge/backend/runs.py": "forge\n" }, "Forge only");
  const core = commit(w.module.gitRoot, { "backend/app.py": "core\n" }, "Core only");

  assert.equal(fileNewCommits(w).filed, 1);
  assert.deepEqual(
    commitsFiled(w).map((r) => r.sha),
    [core],
  );
});

test("a commit is tied to the person's sentence only when it was made after it", () => {
  const w = looking("extensions/forge");
  const sentence = appendRow(
    w.storeRoot,
    "m-1",
    { kind: "said", by: "person", origin: "composer", text: "Show the queue", session: "s-1", author: "ana" },
    () => "2026-03-01T11:00:00.400Z",
  );
  const before = commit(
    w.module.gitRoot,
    { "extensions/forge/a.py": "\n" },
    "Made earlier",
    "2026-03-01T10:59:59Z",
  );
  const sameSecond = commit(
    w.module.gitRoot,
    { "extensions/forge/b.py": "\n" },
    "Made in the same second",
    "2026-03-01T11:00:00Z",
  );

  assert.equal(fileNewCommits(w).filed, 2);
  const rows = commitsFiled(w);
  assert.equal(rows.find((r) => r.sha === before)?.said, undefined);
  assert.equal(rows.find((r) => r.sha === sameSecond)?.said, sentence.id);
});

test("a sentence of another session does not take this session's commits", () => {
  const w = looking("extensions/forge");
  appendRow(
    w.storeRoot,
    "m-1",
    { kind: "said", by: "person", origin: "composer", text: "Other owner", session: "s-0", author: "ana" },
    () => "2026-03-01T11:00:00.000Z",
  );
  commit(w.module.gitRoot, { "extensions/forge/a.py": "\n" }, "Later work", "2026-03-01T11:30:00Z");

  fileNewCommits(w);
  assert.equal(commitsFiled(w)[0].said, undefined);
});

test("a commit is filed once, also when the same range is looked at again", () => {
  const w = looking("extensions/forge");
  const seen = path.join(moduleHome(w.storeRoot, "m-1"), "seen", "ana.json");
  const start = fs.readFileSync(seen, "utf8");
  commit(w.module.gitRoot, { "extensions/forge/a.py": "\n" }, "Work");

  assert.equal(fileNewCommits(w).filed, 1);
  assert.equal(fileNewCommits(w).filed, 0, "nothing new since the last look");
  fs.writeFileSync(seen, start);
  assert.equal(fileNewCommits(w).filed, 0, "the journal already holds it");
  assert.equal(commitsFiled(w).length, 1);
});

test("when the commit last looked at is gone, the record says so and continues from here", () => {
  const w = looking("extensions/forge");
  const seen = path.join(moduleHome(w.storeRoot, "m-1"), "seen", "ana.json");
  fs.writeFileSync(seen, JSON.stringify({ head: "0123456789abcdef0123456789abcdef01234567" }));
  commit(w.module.gitRoot, { "extensions/forge/a.py": "\n" }, "Work");

  const first = fileNewCommits(w);
  assert.equal(first.filed, 0);
  assert.match(first.note ?? "", /0123456.*no longer in this checkout/);
  const head = execFileSync("git", ["-C", w.module.gitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(JSON.parse(fs.readFileSync(seen, "utf8")).head, head);
  assert.deepEqual(fileNewCommits(w), { filed: 0 });
});
