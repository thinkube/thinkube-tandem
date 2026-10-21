/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A slice's standing-suite run runs tests, not the shared setup beside
 * them, and a file that holds no test judges nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runScopedSuite } from "./suite";
import { isSharedTestSetup, isTestPath } from "../core/testShape";

function tree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-shared-setup-"));
  for (const rel of files) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "");
  }
  return root;
}

test("conftest.py is shared test setup: test-shaped, never run as a test", () => {
  assert.equal(isTestPath("tests/conftest.py"), true, "it stays fenced like a test");
  assert.equal(isSharedTestSetup("tests/conftest.py"), true);
  assert.equal(isSharedTestSetup("conftest.py"), true);
  assert.equal(isSharedTestSetup("tests/test_conftest.py"), false);
});

test("a slice that rewrote conftest.py runs the tests beside it, not conftest.py", async () => {
  const root = tree(["tests/conftest.py", "tests/test_text.py", "app/auth.py"]);
  const ran: string[] = [];
  const verdict = await runScopedSuite({
    runOne: "./run_tests.sh <file>",
    root,
    exec: async (cmd) => (ran.push(cmd), { code: 0, output: "3 passed" }),
    footprint: ["tests/conftest.py", "app/auth.py"],
    importersOf: async () => ["tests/test_text.py"],
  });
  assert.deepEqual(ran, ["./run_tests.sh tests/test_text.py"]);
  assert.equal(verdict.green, true);
});

test("pytest's exit 5 for one file is no test there, not a failing test", async () => {
  const root = tree(["tests/test_empty.py", "app/auth.py"]);
  const said: string[] = [];
  const verdict = await runScopedSuite({
    runOne: "./run_tests.sh <file>",
    root,
    exec: async () => ({ code: 5, output: "\nno tests ran in 0.01s\n" }),
    footprint: ["app/auth.py"],
    importersOf: async () => ["tests/test_empty.py"],
    log: (l) => said.push(l),
  });
  assert.equal(verdict.green, true);
  assert.deepEqual(verdict.failures, []);
  assert.match(verdict.summary, /0 green, 0 red, 1 judged nothing/);
  assert.ok(said.some((l) => /tests\/test_empty\.py holds no test \(exit 5/.test(l)), said.join("\n"));
});
