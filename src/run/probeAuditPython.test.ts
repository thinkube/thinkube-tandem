/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A Python check drives what the cut builds when it imports that module,
 * by its dotted name; a live check is never refused for importing nothing
 * of the repository, because it must not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditProbe, pythonImportsOf } from "./probeAudit";

const PLANNED = ["app/main.py", "app/answers.py", "README.md"];

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-audit-py-"));
  fs.mkdirSync(path.join(dir, "app"));
  fs.mkdirSync(path.join(dir, "tests"));
  fs.mkdirSync(path.join(dir, "live"));
  fs.writeFileSync(
    path.join(dir, "thinkube.yaml"),
    ["spec:", "  deploy:", "    run: python3 scripts/deploy.py svc", "    at: https://svc.example.com", "    live:", "      home: live", '      one: "pytest <file>"', ""].join("\n"),
  );
  return dir;
}

const drivesNothing = (probe: string, source: string, root = repo()) =>
  auditProbe(probe, source, root, PLANNED).filter((f) => f.kind === "drives-nothing");

test("Python imports are read by their dotted names", () => {
  assert.deepEqual(
    pythonImportsOf("import app.main\nfrom app.answers import (\n  score,\n  normalise as n,\n)\nfrom . import helpers\nimport os, json as j\n").sort(),
    [".helpers", "app.answers", "app.answers.normalise", "app.answers.score", "app.main", "json", "os"],
  );
});

test("a Python check importing a planned module drives what the cut builds", () => {
  assert.deepEqual(drivesNothing("tests/answers_AC-1_test.py", "from app.answers import score\n\ndef test_x():\n    assert score('a', ['a']) == 1\n"), []);
  assert.deepEqual(drivesNothing("tests/main_AC-2_test.py", "import app.main\n"), []);
  assert.deepEqual(drivesNothing("tests/main_AC-3_test.py", "from app import main\n"), [], "a submodule imported from its package");
  assert.deepEqual(drivesNothing("app/main_AC-4_test.py", "from .answers import score\n"), [], "a relative import, from the check's package");
});

test("a Python check importing nothing the cut builds is refused", () => {
  const faults = drivesNothing("tests/compare_AC-13_test.py", "import json\nfrom fastapi.testclient import TestClient\n");
  assert.equal(faults.length, 1);
  assert.match(faults[0].detail, /imports nothing this cut builds/);
});

test("a live check under the declared live home is never refused for importing nothing", () => {
  assert.deepEqual(drivesNothing("live/retrieval_AC-14_test.py", "import os\nimport httpx\n"), []);
});
