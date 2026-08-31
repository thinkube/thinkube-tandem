/**
 * TRANSITION — every human door's handle now appears in the webview source,
 * or its action is posted from the control as a quoted string, so the proof
 * has something real to find for controls too, not only pages.
 *
 * This pins that for each human door in AFFORDANCES, either its handle
 * (data-<action>) appears literally in webview/map/src, or the action name
 * appears there as a quoted string (the shape a postMessage call takes).
 * Read as source, since the test build never executes webview code. Its job
 * is done once every human door's control is really wired into the surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AFFORDANCES } from "./affordances";
import { webviewSourceText } from "../gates/doors";

test("every handle of a human door in AFFORDANCES appears literally in the webview source, or its action is posted as a quoted string", () => {
  // Read through `webviewSourceText` — the product's own reader — so this
  // check and the door proof it guards mean the same thing by "the webview
  // source". A private one-directory listing here would stay green for a
  // control that moved into `src/proto/`, which the product's recursive
  // reader would still find: the check would be measuring a smaller surface
  // than the code it speaks for.
  const source = webviewSourceText();
  assert.ok(
    source.length > 0,
    "set up: the webview's source was found and read — an empty read proves nothing",
  );

  const humanEntries = Object.entries(AFFORDANCES).filter(([, e]) => e.kind === "human");
  assert.ok(humanEntries.length > 0, "set up: at least one human door is declared");

  for (const [action] of humanEntries) {
    const handle = `data-${action}`;
    const quotedAction = `"${action}"`;
    assert.ok(
      source.includes(handle) || source.includes(quotedAction),
      `door "${action}" has neither its handle "${handle}" nor its quoted action ${quotedAction} in webview/map/src`,
    );
  }
});
