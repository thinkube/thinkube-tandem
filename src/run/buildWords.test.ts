/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A declared build that passed is said in words that claim no more than it
 * ran: for a template, the command passed and the image is judged only by
 * the platform's deploy; for anything else, the product builds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { declaredBuildPassed } from "./buildWords";

test("a template's declared build is not said to build the product, and the deploy is named as the image's judge", () => {
  const said = declaredBuildPassed("python3 -m compileall -q app", true);
  assert.match(said, /^the declared build \(python3 -m compileall -q app\) passes/);
  assert.match(said, /only by the platform's deploy/);
  assert.match(said, /its refusal is the veto/);
  assert.doesNotMatch(said, /product build|builds as shipped/);
});

test("any other repository's declared build is its product build", () => {
  assert.equal(declaredBuildPassed("npm run build", false), "the product build (npm run build) builds as shipped");
});
