/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the person allows a worker to spend, read from the settings in one
 * place so every session of the extension reads them the same way.
 *
 * `0` and the empty string are the settings' own words for "none": no
 * ceiling, no fallback. Neither becomes a value the run acts on.
 */
export function spendSettings(config: { get<T>(key: string, fallback: T): T }): {
  unitBudgetUsd?: number;
  fallbackModel?: string;
} {
  const budget = config.get<number>("unitBudgetUsd", 0);
  const fallback = config.get<string>("fallbackModel", "").trim();
  return {
    ...(typeof budget === "number" && budget > 0 ? { unitBudgetUsd: budget } : {}),
    ...(fallback ? { fallbackModel: fallback } : {}),
  };
}
