/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The honesty scan reads confessions, not names. `TaskStatus.TODO` is an
 * enum's own member; a comment saying TODO is a deferral.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { markerOnlyInStrings, scanStubMarkers } from "./stubScan";
import { confessedDeferrals } from "../../run/planDelivery";

const hits = (content: string) => scanStubMarkers("src/x.py", content).filter((h) => !h.weak).map((h) => h.line);

test("a marker that is part of a name is not a confession", () => {
  assert.deepEqual(
    hits(
      [
        'status: TaskStatus = TaskStatus.TODO',
        'TODO = "todo"',
        'if task.status == "TODO":',
        "self._TODO_count += 1",
        "Status::TODO",
        "state->TODO",
      ].join("\n"),
    ),
    [],
  );
});

test("a marker in prose is", () => {
  assert.deepEqual(
    hits(
      [
        "# TODO: wire the real store",
        "status = TaskStatus.TODO  # FIXME this is never persisted",
        'raise NotImplementedError("not implemented")',
        "// XXX",
      ].join("\n"),
    ),
    [1, 2, 3, 4],
  );
});

test("a marker inside a test's string data is the data, not a confession", () => {
  assert.equal(markerOnlyInStrings('NONE = ["zzz yyy xxx"] * 5'), true);
  assert.equal(markerOnlyInStrings('"hypotheses_b": ["zzz yyy", "xxx www", "vvv uuu"],'), true);
  assert.equal(markerOnlyInStrings('NONE = ["a"] * 5  # TODO: real data'), false, "a comment beside the data is still prose");
  assert.equal(markerOnlyInStrings("# TODO: don't forget"), false);
});

test("the delivery's honesty scan leaves test data alone and still reads production", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-stub-data-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  fs.mkdirSync(path.join(dir, "tests"));
  fs.mkdirSync(path.join(dir, "app"));
  fs.writeFileSync(path.join(dir, "tests", "compare_AC-6_test.py"), 'NONE = ["zzz yyy xxx"] * 5\n');
  fs.writeFileSync(path.join(dir, "app", "compare.py"), "MISSING = None  # TODO: the real store\n");
  git("add", "-A");
  git("commit", "-q", "-m", "work");
  const hits: string[] = [];
  await confessedDeferrals({
    worktree: dir,
    baseSha: base,
    exec: async (cmd, args) => ({ code: 0, out: execFileSync(cmd, args, { encoding: "utf8" }) }),
    extraPaths: [],
    onHit: (file) => hits.push(file),
  });
  assert.deepEqual(hits, ["app/compare.py"]);
});
