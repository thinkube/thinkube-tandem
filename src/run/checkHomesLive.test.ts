/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A live check says nothing about where the repository keeps its unit
 * tests.
 *
 * A Python service keeps its code under `app/` and its tests under
 * `tests/`. Its first cut delivered a live check, `live/test_answers.py`,
 * named like a unit test. At the next cut the idiom saw tests under two
 * directories, gave up on a shared one, and minted every check beside its
 * module in `app/` — inside the image.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checksInAnotherLanguage, rehouseChecks, unreachableCheckHomes } from "./checkHomes";

const REPO = ["app/main.py", "app/classification.py", "tests/conftest.py", "tests/test_health.py", "live/test_answers.py"];
const isLive = (f: string): boolean => f.startsWith("live/");

function plan() {
  return [
    {
      handle: "SL-1",
      workUnits: [
        { role: "code", footprint: ["app/classification.py"] },
        { role: "test", footprint: ["probes/scoring__SL-1_AC-1.test.mjs"] },
      ],
    },
  ];
}

test("with the live check told apart, a check is born in tests/, where the repository runs its unit tests", () => {
  const slices = plan();
  rehouseChecks(slices, REPO, new Set(), [], isLive);
  assert.deepEqual(slices[0].workUnits[1].footprint, ["tests/classification_AC-1_test.py"]);
  assert.deepEqual(unreachableCheckHomes(slices, REPO, [], isLive).where, []);
  assert.deepEqual(checksInAnotherLanguage(slices, REPO, isLive).languages, ["py"]);
});

test("counted as a unit test, the same live check would send the check beside its module, into the image", () => {
  const slices = plan();
  rehouseChecks(slices, REPO);
  assert.deepEqual(slices[0].workUnits[1].footprint, ["app/classification_AC-1_test.py"]);
});
