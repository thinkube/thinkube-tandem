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
