/**
 * TRANSITION — builtSurfaceText is a new seam: reading the built webview
 * text is now an injected function, so the door proof can be driven without
 * a real build on disk, and a missing or broken build never crashes it.
 *
 * This pins that builtSurfaceText returns exactly what its injected reader
 * produced, and returns an empty string — never throwing — when that reader
 * throws (the shape of a missing build). Its job is done once the seam
 * exists and both paths are exercised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtSurfaceText } from "../gates/doors";

test("builtSurfaceText returns the text its injected reader produced", () => {
  const text = builtSurfaceText(() => "<div data-work-page></div>");

  assert.equal(text, "<div data-work-page></div>", "the reader's own output is returned unchanged");
});

test("builtSurfaceText returns empty string when the reader throws", () => {
  const text = builtSurfaceText(() => {
    throw new Error("ENOENT: no built surface");
  });

  assert.equal(text, "", "a reader that throws (a missing build) yields empty string, not a thrown error");
});
