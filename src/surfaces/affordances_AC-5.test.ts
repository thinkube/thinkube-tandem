/**
 * INVARIANT — every page the registry declares carries a readable label and
 * a real handle, so an instruction can always be shown in words and the
 * door proof always has a `data-` attribute to look for.
 *
 * A page entry with an empty label would print nothing a person can read;
 * a handle not starting with "data-" would never match anything the webview
 * actually renders. This must hold for as long as PAGES exists, for every
 * entry it ever gains.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES } from "./affordances";

test("every key of PAGES carries a non-empty label and a handle beginning with data-", () => {
  const keys = Object.keys(PAGES);
  assert.ok(keys.length > 0, "set up: PAGES declares at least one page");

  for (const key of keys) {
    const entry = PAGES[key];
    assert.ok(
      typeof entry.label === "string" && entry.label.trim().length > 0,
      `page "${key}" has a non-empty label, got ${JSON.stringify(entry.label)}`,
    );
    assert.ok(
      typeof entry.handle === "string" && entry.handle.startsWith("data-"),
      `page "${key}" has a handle beginning with "data-", got ${JSON.stringify(entry.handle)}`,
    );
  }
});
