/**
 * TRANSITION — the webview now marks each page with the handle its PAGES
 * entry declares, so the door proof has something real in the source to
 * find rather than a registry entry describing a control nobody built.
 *
 * This pins that every handle declared in PAGES appears literally in the
 * webview's own source files under webview/map/src — read as source, since
 * the test build compiles only the host tree and never executes webview
 * code. Its job is done once every page carries its handle in the JSX.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES } from "./affordances";
import { webviewSourceText } from "../gates/doors";

test("every handle declared in PAGES appears literally in the webview source under webview/map/src", () => {
  // The source is read through `webviewSourceText`, the same function the
  // product's own door proof uses, rather than a directory listing this
  // check keeps for itself. A private reader here listed one directory and
  // no deeper, so a page whose JSX moved into `src/proto/` would keep this
  // check green while the product's recursive reader saw the truth — the
  // check and the product would disagree about what "the webview source"
  // means, and only the check would be happy.
  const source = webviewSourceText();
  assert.ok(
    source.length > 0,
    "set up: the webview's source was found and read — an empty read proves nothing",
  );

  const handles = Object.values(PAGES).map((p) => p.handle);
  assert.ok(handles.length > 0, "set up: at least one page handle is declared");

  for (const handle of handles) {
    assert.ok(
      source.includes(handle),
      `handle "${handle}" does not appear literally in any file under webview/map/src`,
    );
  }
});
