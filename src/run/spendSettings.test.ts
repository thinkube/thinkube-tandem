/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** The spend settings: a fallback model, or none. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spendSettings } from "./spendSettings";

function settings(values: Record<string, unknown>) {
  return { get: <T>(key: string, fallback: T): T => (key in values ? (values[key] as T) : fallback) };
}

test("a fallback model is read as given, without its surrounding spaces", () => {
  assert.deepEqual(spendSettings(settings({ fallbackModel: " sonnet " })), { fallbackModel: "sonnet" });
});

test("an empty name is the setting's word for none, and reaches the run as nothing", () => {
  assert.deepEqual(spendSettings(settings({ fallbackModel: "" })), {});
  assert.deepEqual(spendSettings(settings({})), {});
});
