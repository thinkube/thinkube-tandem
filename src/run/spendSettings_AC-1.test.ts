/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spendSettings } from "./spendSettings";

function configOf(values: Record<string, unknown>) {
  return {
    get<T>(key: string, fallback: T): T {
      return key in values ? (values[key] as T) : fallback;
    },
  };
}

// WHY (standing INVARIANT): a negative unitBudgetUsd is read exactly like 0 — no ceiling reaches the run — while a fallback model set beside it is still read.
test("a negative unitBudgetUsd gives the same spend settings as 0, and the fallback model is still read", () => {
  const zero = spendSettings(configOf({ unitBudgetUsd: 0, fallbackModel: "haiku" }));
  for (const negative of [-1, -0.5]) {
    const got = spendSettings(configOf({ unitBudgetUsd: negative, fallbackModel: "haiku" }));
    assert.deepEqual(got, zero);
    assert.equal("unitBudgetUsd" in got, false);
    assert.equal(got.fallbackModel, "haiku");
  }
});
