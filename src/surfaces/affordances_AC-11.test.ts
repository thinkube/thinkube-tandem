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
import * as fs from "node:fs";
import * as path from "node:path";
import { PAGES } from "./affordances";

function readWebviewSource(): string {
  const dir = path.join(__dirname, "..", "..", "webview", "map", "src");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  return files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

test("every handle declared in PAGES appears literally in the webview source under webview/map/src", () => {
  const source = readWebviewSource();
  const handles = Object.values(PAGES).map((p) => p.handle);
  assert.ok(handles.length > 0, "set up: at least one page handle is declared");

  for (const handle of handles) {
    assert.ok(
      source.includes(handle),
      `handle "${handle}" does not appear literally in any file under webview/map/src`,
    );
  }
});
