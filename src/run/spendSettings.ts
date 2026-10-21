/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the person tells a worker to fall back to, read from the settings in
 * one place so every session of the extension reads it the same way.
 *
 * The empty string is the setting's own word for "none". It never becomes a
 * value the run acts on.
 */
export function spendSettings(config: { get<T>(key: string, fallback: T): T }): {
  fallbackModel?: string;
} {
  const fallback = config.get<string>("fallbackModel", "").trim();
  return fallback ? { fallbackModel: fallback } : {};
}
