/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A Python check is asked what it executed by the recorder a
 * `sitecustomize` installs, with no package: a check that drives its
 * subject is proven, one that never reaches it is not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { provedByExecution } from "./wiring";

const exec = (cmd: string, cwd: string): Promise<{ code: number | null; output: string }> =>
  new Promise((resolve) =>
    execFile("sh", ["-c", cmd], { cwd, encoding: "utf8" }, (err, out, errOut) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, output: `${out}\n${errOut}` }),
    ),
  );

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-wiring-python-"));
  fs.mkdirSync(path.join(dir, "app"));
  fs.mkdirSync(path.join(dir, "tests"));
  fs.writeFileSync(path.join(dir, "app", "__init__.py"), "");
  fs.writeFileSync(path.join(dir, "app", "answers.py"), "def score(a, b):\n    return 1.0 if a == b else 0.0\n");
  fs.writeFileSync(
    path.join(dir, "tests", "answers_AC-1_test.py"),
    "import sys, os\nsys.path.insert(0, os.getcwd())\nfrom app.answers import score\nassert score('a', 'a') == 1.0\n",
  );
  fs.writeFileSync(path.join(dir, "tests", "answers_AC-2_test.py"), "assert 1 + 1 == 2\n");
  return dir;
}

test("a Python check that drives its subject is proven by what it executed", async () => {
  const verdict = await provedByExecution({
    run: "python3 tests/answers_AC-1_test.py",
    subjects: ["app/answers.py"],
    worktree: repo(),
    exec,
  });
  assert.equal(verdict.executed, "yes", verdict.detail);
});

test("a Python check that never reaches its subject is not a proof", async () => {
  const verdict = await provedByExecution({
    run: "python3 tests/answers_AC-2_test.py",
    subjects: ["app/answers.py"],
    worktree: repo(),
    exec,
  });
  assert.equal(verdict.executed, "no", verdict.detail);
});

test("the recorder keeps the PYTHONPATH the check was given", async () => {
  const dir = repo();
  const verdict = await provedByExecution({
    run: "python3 -c 'import app.answers'",
    subjects: ["app/answers.py"],
    worktree: dir,
    // app/ is importable only through the PYTHONPATH the environment gives.
    exec: (cmd, cwd) => exec(`export PYTHONPATH=.; ${cmd}`, cwd),
  });
  assert.equal(verdict.executed, "yes", verdict.detail);
});
