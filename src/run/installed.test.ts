/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The versions a judge reads are the ones the repository installs: read
 * from its pins, through the repository modules the check imports, and
 * never made up for a library no pin names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installedVersions } from "./installed";

function pythonRepo(): string {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "installed-"));
  fs.mkdirSync(path.join(tree, "app"));
  fs.mkdirSync(path.join(tree, "tests"));
  fs.writeFileSync(path.join(tree, "app", "__init__.py"), "");
  fs.writeFileSync(path.join(tree, "app", "main.py"), "from fastapi import FastAPI\nfrom sqlalchemy import text\n\napp = FastAPI()\n");
  fs.writeFileSync(
    path.join(tree, "tests", "main_AC-2_test.py"),
    "import pytest\nfrom app.main import app\nfrom fastapi.routing import APIRoute\n\ndef test_x():\n    assert app\n",
  );
  return tree;
}

test("a check's libraries are read from requirements.txt, through the modules it imports", () => {
  const tree = pythonRepo();
  fs.writeFileSync(path.join(tree, "requirements.txt"), "fastapi==0.141.1\nSQLAlchemy==2.1.4\nhttpx>=0.28\n");
  const out = installedVersions(tree, "tests/main_AC-2_test.py");
  assert.match(out, /- fastapi: 0\.141\.1 \(requirements\.txt\)/);
  assert.match(out, /- sqlalchemy: 2\.1\.4 \(requirements\.txt\)/, "a library the imported module uses is listed");
  assert.match(out, /Not pinned in requirements\.txt .*: pytest/, "a library no pin names is said to be unpinned");
  assert.doesNotMatch(out, /httpx/, "a pin the check does not touch is not listed");
  assert.doesNotMatch(out, /- app:/, "the repository's own package is not a library");
});

test("a lockfile is read the same way", () => {
  const tree = pythonRepo();
  fs.writeFileSync(
    path.join(tree, "uv.lock"),
    'version = 1\n\n[[package]]\nname = "fastapi"\nversion = "0.141.1"\n\n[[package]]\nname = "sqlalchemy"\nversion = "2.1.4"\n',
  );
  assert.match(installedVersions(tree, "tests/main_AC-2_test.py"), /- fastapi: 0\.141\.1 \(uv\.lock\)/);
});

test("with no pin file the reply names the missing sources and invents no version", () => {
  const tree = pythonRepo();
  const out = installedVersions(tree, "tests/main_AC-2_test.py");
  assert.match(out, /^No installed version is known: this repository has none of uv\.lock, poetry\.lock, requirements\*\.txt, package-lock\.json/);
  assert.doesNotMatch(out, /\d+\.\d+\.\d+/);
});

test("an npm check reads package-lock.json", () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "installed-npm-"));
  fs.mkdirSync(path.join(tree, "src"));
  fs.writeFileSync(path.join(tree, "src", "app.ts"), 'import express from "express";\nexport const app = express();\n');
  fs.writeFileSync(path.join(tree, "src", "app_AC-1.test.ts"), 'import { test } from "node:test";\nimport { app } from "./app";\n');
  fs.writeFileSync(
    path.join(tree, "package-lock.json"),
    JSON.stringify({ packages: { "": {}, "node_modules/express": { version: "5.1.0" } } }),
  );
  const out = installedVersions(tree, "src/app_AC-1.test.ts");
  assert.match(out, /- express: 5\.1\.0 \(package-lock\.json\)/);
  assert.match(out, /Not pinned .*node:test/);
});
