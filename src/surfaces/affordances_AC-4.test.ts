/**
 * TRANSITION — every human affordance now names one of the surface's real
 * pages instead of prose like "units map" or "the reading page" that
 * matches nothing on screen.
 *
 * Before this change AFFORDANCES.affordance.surface was free text with no
 * relation to any page the webview actually draws. This pins that every
 * human entry's page reference is a key of PAGES — importing both registries
 * and checking each entry, not scraping strings. Its job is done once every
 * entry is bound to a real page; PAGES itself staying in sync is covered
 * elsewhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AFFORDANCES, PAGES } from "./affordances";

test("every human entry in AFFORDANCES names a page that is a key of PAGES", () => {
  const humanEntries = Object.entries(AFFORDANCES).filter(([, e]) => e.kind === "human");
  assert.ok(humanEntries.length > 0, "set up: there is at least one human affordance to check");

  const pageKeys = new Set(Object.keys(PAGES));
  for (const [action, entry] of humanEntries) {
    const page = (entry as { affordance: { page: string } }).affordance.page;
    assert.ok(
      pageKeys.has(page),
      `${action} names page "${page}", which is not a key of PAGES (${[...pageKeys].join(", ")})`,
    );
  }
});
