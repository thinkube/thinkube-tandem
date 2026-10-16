/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What settles a criterion after the merge follows from the target and
 * from whether it declares live checks: a repository that declares them
 * has the running service as a source of its own, and a criterion's
 * `settledBy` is always one of the target's sources when it can be.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVE_SETTLING, settledByOf, settledOnTheLiveProduct, settlingSourcesOf, TEMPLATE_SETTLING } from "./ground";

test("a repository that declares live checks has the running service as a settling source", () => {
  const app = settlingSourcesOf("gitops-app", true);
  assert.equal(app.length, 2);
  assert.equal(app[1], LIVE_SETTLING);
  assert.equal(settlingSourcesOf("gitops-app", false).length, 1, "without live checks the pipeline alone");
  assert.deepEqual(settlingSourcesOf("template", true), [TEMPLATE_SETTLING], "a template's own source already is the running service");
  assert.deepEqual(settlingSourcesOf("script", true), [LIVE_SETTLING]);
  assert.deepEqual(settlingSourcesOf("script", false), []);
});

test("a criterion's settledBy is one of the target's sources", () => {
  assert.equal(settledByOf("the template's validation deploy", [TEMPLATE_SETTLING]), TEMPLATE_SETTLING, "one source is the only one meant");
  const both = settlingSourcesOf("gitops-app", true);
  assert.equal(settledByOf(` ${LIVE_SETTLING.toUpperCase()} `, both), LIVE_SETTLING, "an exact copy names its source");
  assert.equal(settledByOf("somewhere else", both), "somewhere else", "any other wording is the model's own");
  assert.ok(settledOnTheLiveProduct(LIVE_SETTLING) && settledOnTheLiveProduct(TEMPLATE_SETTLING));
  assert.ok(!settledOnTheLiveProduct(both[0]));
});
