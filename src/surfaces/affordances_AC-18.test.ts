/**
 * TRANSITION — a check now drives the door proof against the surface this
 * build actually ships, so a control or a page that stops rendering fails
 * the build instead of waiting for a person to notice on a delivery page.
 *
 * This pins the positive path against the surface's own source files: every
 * handle PAGES declares, and every human door's handle in AFFORDANCES,
 * appears literally in webview/map/src. The source is read rather than the
 * built bundle because the test build compiles only the host tree and never
 * runs the webview build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtSurfaceText, missingDoors, missingPages, webviewSourceText } from "./doors";

test("no declared door and no declared page is missing from the webview's real source", () => {
  // The surface's OWN source files, read from disk — never markup this check
  // builds for itself. Manufacturing the text from the same two registries
  // the assertions then read makes the check tautological: it passes for a
  // webview that renders nothing at all. Reading webview/map/src is the only
  // way this promise is about the surface rather than about itself.
  const sourceText = builtSurfaceText(() => webviewSourceText());

  assert.ok(
    sourceText.length > 0,
    "set up: the webview's source was found and read — an empty read proves nothing",
  );

  assert.deepEqual(
    missingPages(sourceText),
    [],
    "every handle declared in PAGES appears literally in the webview source under webview/map/src",
  );
  assert.deepEqual(
    missingDoors(sourceText),
    [],
    "every handle of a human door in AFFORDANCES appears literally in the webview source, or its action appears as a quoted string posted from it",
  );
});
