/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A repair the reviewers asked for is measured by the tree changing and
 * building, not by the build alone — which already passed when they looked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { measureOnTheProduct, measureTheBuild, measureTheSuite, withSharedTestSetup } from "./repairLive";
import { repairUntilLive } from "./tryAgain";
import { isTestStep } from "./harvest";

test("an untouched tree is red for a repair the reviewers asked for, whatever the build says", () => {
  const m = measureOnTheProduct({ build: { ok: true, output: "" }, changed: false, evidence: "  - the count reads '1 of 2 task'" });
  assert.equal(m.green, false);
  assert.match(m.evidence, /nothing in the tree has changed yet/);
  assert.match(m.evidence, /1 of 2 task/);
});

test("a changed tree that builds is green; a changed tree that does not build says so", () => {
  assert.equal(measureOnTheProduct({ build: { ok: true, output: "" }, changed: true, evidence: "" }).green, true);
  const red = measureOnTheProduct({ build: { ok: false, output: "TS2322: wrong" }, buildCommand: "npm run build", changed: true, evidence: "" });
  assert.equal(red.green, false);
  assert.match(red.evidence, /BUILD FAILS HERE \(npm run build\)/);
});

test("a repair the platform's refusal asked for is measured by the build alone", () => {
  assert.equal(measureTheBuild({ build: { ok: true, output: "" } }).green, true);
  assert.equal(measureTheBuild({ build: { ok: false, output: "boom" } }).green, false);
});

test("a repair of the pipeline's test step is measured by the whole suite, not the build", () => {
  const red = measureTheSuite({
    build: { ok: true, output: "" },
    suite: { code: 1, output: "FAILED tests/compare_AC-10_test.py::test_refuses\n12 failed, 30 passed" },
    suiteCommand: "./run_tests.sh",
  });
  assert.equal(red.green, false, "a green build does not make a red suite green");
  assert.match(red.evidence, /WHOLE SUITE FAILS HERE \(\.\/run_tests\.sh, exit 1\)/);
  assert.match(red.evidence, /12 failed/);
  assert.equal(
    measureTheSuite({ build: { ok: true, output: "" }, suite: { code: 0, output: "" }, suiteCommand: "./run_tests.sh" }).green,
    true,
  );
  assert.equal(
    measureTheSuite({ build: { ok: false, output: "SyntaxError" }, suite: { code: 0, output: "" }, suiteCommand: "./run_tests.sh" }).green,
    false,
  );
});

test("the test step's repair may edit the shared test setup beside the test files the log names", () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-repairlive-"));
  fs.mkdirSync(path.join(wt, "tests"));
  fs.writeFileSync(path.join(wt, "tests", "conftest.py"), "");
  fs.writeFileSync(path.join(wt, "tests", "compare_AC-10_test.py"), "");
  assert.deepEqual(withSharedTestSetup(["tests/compare_AC-10_test.py", "app/main.py"], wt).sort(), [
    "app/main.py",
    "tests/compare_AC-10_test.py",
    "tests/conftest.py",
  ]);
  assert.deepEqual(withSharedTestSetup(["app/main.py"], wt), ["app/main.py"], "no test file named, no shared setup");
});

test("the pipeline's test steps are known by their names", () => {
  for (const n of ["run-test", "test-scoring", "tests"]) assert.equal(isTestStep(n), true, n);
  for (const n of ["build-amd64", "scoring-build-qg7xs", "contest"]) assert.equal(isTestStep(n), false, n);
});

test("nothing is pushed after a test-step repair until the check before pushing is given that attempt", async () => {
  const given: (boolean | undefined)[] = [];
  let landed = 0;
  await repairUntilLive(
    {
      whyItFailed: async () => ({ evidence: "FAILED tests/a_test.py", files: ["tests/a_test.py"], testStep: true }),
      repair: async () => ({ green: true, report: "" }),
      buildsHere: async (found) => {
        given.push(found.testStep);
        return { ok: false, output: "12 failed" };
      },
      land: async () => {
        landed++;
        return { ok: true, moved: true };
      },
      waitUntilLive: async () => ({ live: true }),
      say: () => {},
      doing: () => {},
    },
    1,
  );
  assert.deepEqual(given, [true]);
  assert.equal(landed, 0, "a red suite here pushes nothing");
});

test("an unchanged tree is judged by the live checks run again now, not by their last result", () => {
  const held = measureOnTheProduct({
    build: { ok: true, output: "" },
    changed: false,
    evidence: "  - a compare request without a seed gets 422 — got 200",
    rechecked: { green: true, evidence: "" },
  });
  assert.equal(held.green, true);
  assert.match(held.evidence, /run again just now against the deployed service, and they hold/);
  const still = measureOnTheProduct({
    build: { ok: true, output: "" },
    changed: false,
    evidence: "  - stale words",
    rechecked: { green: false, evidence: "  - got 200 at 10:33" },
  });
  assert.equal(still.green, false);
  assert.match(still.evidence, /RUN AGAIN JUST NOW/);
  assert.match(still.evidence, /got 200 at 10:33/);
  assert.doesNotMatch(still.evidence, /stale words/, "the last result is not replayed");
});
