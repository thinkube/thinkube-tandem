/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** The spend settings: a ceiling and a fallback, or neither. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spendSettings } from "./spendSettings";

function settings(values: Record<string, unknown>) {
  return { get: <T>(key: string, fallback: T): T => (key in values ? (values[key] as T) : fallback) };
}

test("a ceiling and a fallback are read as given", () => {
  assert.deepEqual(spendSettings(settings({ unitBudgetUsd: 2.5, fallbackModel: " sonnet " })), {
    unitBudgetUsd: 2.5,
    fallbackModel: "sonnet",
  });
});

test("zero and an empty name are the settings' words for none, and reach the run as nothing", () => {
  assert.deepEqual(spendSettings(settings({ unitBudgetUsd: 0, fallbackModel: "" })), {});
  assert.deepEqual(spendSettings(settings({})), {});
});

test("a negative budget is read exactly like 0: no ceiling, the fallback still read", () => {
  for (const negative of [-1, -0.5]) {
    const got = spendSettings(settings({ unitBudgetUsd: negative, fallbackModel: "haiku" }));
    assert.deepEqual(got, spendSettings(settings({ unitBudgetUsd: 0, fallbackModel: "haiku" })));
    assert.equal("unitBudgetUsd" in got, false);
    assert.equal(got.fallbackModel, "haiku");
    assert.deepEqual(spendSettings(settings({ unitBudgetUsd: negative })), {});
  }
});
