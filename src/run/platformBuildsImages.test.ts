/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A repository whose thinkube.yaml declares containers has its images built
 * and tested by the platform's pipeline. Its product build is judged there:
 * a run sets up no build of its own beside the editor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSetup } from "./facts";
import { imagesBuiltByPlatform } from "../core/thinkubeYaml";

const READING = { provision: "cd frontend && npm ci", prepare: "", runOne: "frontend/run_tests.sh <file>", build: "cd frontend && npm run build" };

function repo(yaml?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "platform-builds-"));
  if (yaml !== undefined) fs.writeFileSync(path.join(root, "thinkube.yaml"), yaml);
  return root;
}

const APP = [
  "apiVersion: thinkube.io/v1",
  "kind: ThinkubeDeployment",
  "spec:",
  "  containers:",
  "    - name: frontend",
  "      build: .",
  "",
].join("\n");

test("a repository that declares containers sets up no product build: the pipeline judges it", () => {
  const root = repo(APP);
  assert.equal(imagesBuiltByPlatform(root), true);
  const setup = runSetup(root, READING);
  assert.equal(setup.build, undefined);
  assert.equal(setup.provision, READING.provision, "everything else the run needs is kept");
  assert.equal(setup.runOne, READING.runOne);
});

test("a repository the platform does not build keeps the build its reading found", () => {
  const plain = repo();
  assert.equal(imagesBuiltByPlatform(plain), false);
  assert.equal(runSetup(plain, READING).build, READING.build);
  const parts = repo("apiVersion: thinkube.io/v1\nkind: ThinkubeDeployment\nspec:\n  deployment:\n    type: none\n");
  assert.equal(imagesBuiltByPlatform(parts), false);
});

test("a thinkube.yaml that cannot be read is said, not taken for no containers", () => {
  const root = repo(APP);
  fs.chmodSync(path.join(root, "thinkube.yaml"), 0o000);
  try {
    if (process.getuid?.() === 0) return;
    assert.throws(() => imagesBuiltByPlatform(root), /thinkube\.yaml exists but could not be read/);
  } finally {
    fs.chmodSync(path.join(root, "thinkube.yaml"), 0o644);
  }
});
