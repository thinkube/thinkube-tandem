/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A delivery commits the work and never what a tool generated beside it,
 * even in a repository with no ignore rule for it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { defaultExec } from "./oracle";
import { stageWork } from "./stageWork";

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-stage-"));
  const g = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "app"));
  fs.writeFileSync(path.join(dir, "app", "main.py"), "x = 1\n");
  g("add", "app/main.py");
  g("commit", "-q", "-m", "base");
  return dir;
}

test("a tree with a stray __pycache__ commits only the real change", async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "app", "main.py"), "x = 2\n");
  fs.mkdirSync(path.join(dir, "app", "__pycache__"));
  fs.writeFileSync(path.join(dir, "app", "__pycache__", "x.pyc"), "\0\0compiled");
  const said: string[] = [];

  const r = await stageWork({ worktree: dir, exec: defaultExec, log: (l) => said.push(l) });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "work"]);

  const committed = execFileSync("git", ["-C", dir, "show", "--name-only", "--format=", "HEAD"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(committed, ["app/main.py"], "only the change is committed");
  assert.deepEqual(r.staged, ["app/main.py"]);
  assert.deepEqual(r.leftOut, ["app/__pycache__/x.pyc"]);
  assert.equal(r.toCommit, true);
  assert.equal(said.length, 1);
  assert.ok(said[0].includes("app/__pycache__/x.pyc"), "what was left out is said");
});

test("new files, deletions and ignored files are each handled as git would, minus generated ones", async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, ".gitignore"), "secret.env\n");
  fs.writeFileSync(path.join(dir, "secret.env"), "K=V\n");
  fs.writeFileSync(path.join(dir, "app", "new file.py"), "y = 1\n");
  fs.rmSync(path.join(dir, "app", "main.py"));
  fs.mkdirSync(path.join(dir, "node_modules", "left-pad"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "left-pad", "index.js"), "");

  const r = await stageWork({ worktree: dir, exec: defaultExec, log: () => {} });

  const index = execFileSync("git", ["-C", dir, "diff", "--cached", "--no-renames", "--name-status"], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(index, ["A\t.gitignore", "A\tapp/new file.py", "D\tapp/main.py"]);
  assert.deepEqual(r.leftOut, ["node_modules/left-pad/index.js"]);
});

test("a tree with nothing but generated files has nothing to commit", async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "app", "main.pyc"), "\0");
  const r = await stageWork({ worktree: dir, exec: defaultExec, log: () => {} });
  assert.equal(r.toCommit, false);
  assert.deepEqual(r.staged, []);
});
