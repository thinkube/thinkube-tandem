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

// WHY (standing INVARIANT): a positive unitBudgetUsd is still read as the ceiling it states.
test("a positive unitBudgetUsd is read as the ceiling it states", () => {
  assert.equal(spendSettings(configOf({ unitBudgetUsd: 2.5 })).unitBudgetUsd, 2.5);
  assert.equal(spendSettings(configOf({ unitBudgetUsd: 10, fallbackModel: "haiku" })).unitBudgetUsd, 10);
});
