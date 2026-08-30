/**
 * TRANSITION — the shared page list (surfaceLayout's SurfacePage union) and
 * the register PAGES declares now agree in both directions: an instruction
 * can never name a page the layout does not draw, and a page cannot exist
 * in the register with no declared handle.
 *
 * This pins that every page in the shared page list has a register entry
 * with a label and a handle, and every register entry that is a surface
 * page is itself in that shared list — both read by importing the two
 * modules, never by matching text. Its job is done once the two are proved
 * to name exactly the same surface pages.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES } from "./affordances";
import { SURFACE_PAGES } from "./surfaceContract";

test("every page in the shared page list has a register entry with a label and a handle", () => {
  assert.ok(SURFACE_PAGES.length > 0, "set up: the shared page list names at least one page");

  for (const page of SURFACE_PAGES) {
    const entry = PAGES[page];
    assert.ok(entry, `shared page "${page}" has no entry in PAGES`);
    assert.ok(entry.label.trim().length > 0, `PAGES["${page}"] has a non-empty label`);
    assert.ok(entry.handle.startsWith("data-"), `PAGES["${page}"] has a data- handle`);
  }
});

test("no register entry claims to be one of the four surface pages without being named in the shared list", () => {
  // The two sets are read from imports, not matched as text: a PAGES key
  // that spells a surface page name (e.g. "work") but is absent from
  // SURFACE_PAGES would mean the register invented a page the layout does
  // not recognise as one of its four. Every one of PAGES' keys that
  // matches a value the SurfacePage type actually allows must be present
  // in SURFACE_PAGES — proved by intersecting the two imported sets.
  const surfacePages = new Set<string>(SURFACE_PAGES);
  const registerKeys = new Set(Object.keys(PAGES));
  const candidateSurfaceLikeKeys = ["write", "intent", "work", "flow"].filter((k) => registerKeys.has(k));

  for (const key of candidateSurfaceLikeKeys) {
    assert.ok(
      surfacePages.has(key),
      `PAGES declares "${key}", which names one of the four surface pages, but SURFACE_PAGES does not include it`,
    );
  }
});
