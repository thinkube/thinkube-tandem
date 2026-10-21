/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A check lands where the repository's runner runs it, in that runner's
 * language, or the plan is refused before dispatch; and a check whose
 * runner executed no test of it is never green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checksInAnotherLanguage, rehouseChecks } from "./checkHomes";
import { runAcVerifications } from "../engine/core/closingGate";
import { testsRanIn } from "../engine/core/testsRan";

/** A Python service: code under app/, every test under tests/. */
const PYTHON = ["app/main.py", "app/db.py", "tests/conftest.py", "tests/test_health.py", "tests/database_AC-9_test.py", "run_tests.sh"];

/** A slice whose only work is tests another slice writes: no module to sit beside. */
const subjectless = () => [
  {
    handle: "SL-3",
    workUnits: [
      { role: "test", footprint: ["probes/svc__SL-3_AC-1.test.mjs"] },
      { role: "test", footprint: ["probes/svc__SL-3_AC-2.test.mjs"] },
    ],
  },
  { handle: "SL-3-tests", workUnits: [{ role: "code", footprint: ["tests/test_database_isolation.py"] }] },
];

test("a slice with no module of its own has its checks placed in the repository's test directory, in its language", () => {
  const slices = subjectless();
  rehouseChecks(slices, PYTHON);
  const placed = slices[0].workUnits.flatMap((u) => u.footprint);
  assert.deepEqual(placed, ["tests/SL-3_AC-1_test.py", "tests/SL-3_AC-2_test.py"]);
  assert.deepEqual(checksInAnotherLanguage(slices, PYTHON).where, []);
});

test("a check an earlier run left at the probe coordinate in another language is refused before dispatch, by name", () => {
  const slices = subjectless();
  const left = new Set(["probes/svc__SL-3_AC-1.test.mjs", "probes/svc__SL-3_AC-2.test.mjs"]);
  rehouseChecks(slices, PYTHON, left);
  const foreign = checksInAnotherLanguage(slices, PYTHON);
  assert.deepEqual(foreign.where, ["SL-3: probes/svc__SL-3_AC-1.test.mjs", "SL-3: probes/svc__SL-3_AC-2.test.mjs"]);
  assert.deepEqual(foreign.languages, ["py"]);
});

test("a JavaScript repository's probes are not refused", () => {
  const slices = subjectless();
  const js = ["src/a.ts", "src/a.test.ts"];
  assert.deepEqual(checksInAnotherLanguage(slices, js).where, []);
});

test("what runners print is read for whether a test ran", () => {
  assert.equal(testsRanIn("1 passed in 0.03s"), "ran");
  assert.equal(testsRanIn("ℹ tests 1\nℹ pass 1\nℹ fail 0"), "ran");
  assert.equal(testsRanIn("ok 1 - holds\n1..1"), "ran");
  assert.equal(testsRanIn("ERROR: not found: /w/probes/x.test.mjs\n(no match in any of [<Dir w>])\nno tests ran in 0.01s"), "none");
  assert.equal(testsRanIn("collected 0 items"), "none");
  assert.equal(testsRanIn("ℹ tests 0\nℹ pass 0"), "none");
  assert.equal(testsRanIn(""), "silent");
});

test("a check run with exit 0 whose runner ran no test of it is red, never green", async () => {
  const [r] = await runAcVerifications(
    [{ ac: 1, run: "./run_tests.sh probes/x.test.mjs" } as never],
    "/nowhere",
    async () => ({ code: 0, output: "no tests ran in 0.01s" }),
  );
  assert.equal(r.pass, false);
  assert.ok(!r.unrunnable, "a run that executed nothing of the check is red");
  assert.match(r.evidence ?? "", /executed no test of this check/);
});

test("a check run with exit 0 and nothing to show a test ran is unjudged, with the reason", async () => {
  const [r] = await runAcVerifications(
    [{ ac: 1, run: "./run_tests.sh probes/x.test.mjs" } as never],
    "/nowhere",
    async () => ({ code: 0, output: "" }),
  );
  assert.equal(r.pass, false);
  assert.equal(r.unrunnable, true);
  assert.match(r.evidence ?? "", /without showing any test of this check run/);
});

test("a check whose runner shows its tests ran and passed stays green", async () => {
  const [r] = await runAcVerifications(
    [{ ac: 1, run: "./run_tests.sh tests/a_AC-1_test.py" } as never],
    "/nowhere",
    async () => ({ code: 0, output: "..\n2 passed in 0.12s" }),
  );
  assert.equal(r.pass, true);
});
