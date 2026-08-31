/**
 * TRANSITION — proves the refusal path replaces today's silent failure:
 * when no space can be named (no slug, or no owner key) panelOpening must
 * return a plain-words refusal and neither a key nor a title, so the
 * caller opens nothing instead of a tab titled "Tandem" bound to key
 * "unknown".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { panelOpening } from "./spaceOps";

test("panelOpening with no slug returns a refusal sentence and no key or title", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac4-"));

  const opening = panelOpening(storeRoot, "repo1", undefined);

  assert.ok("refusal" in opening, "nothing can be named, so nothing is opened");
  if (!("refusal" in opening)) return;
  assert.equal(typeof opening.refusal, "string");
  assert.ok(opening.refusal.length > 0, "the refusal is a plain sentence, not empty");
  assert.equal((opening as { key?: unknown }).key, undefined, "no key is returned alongside a refusal");
  assert.equal((opening as { title?: unknown }).title, undefined, "no title is returned alongside a refusal");
});

test("panelOpening with no owner key returns a refusal sentence", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac4b-"));

  const opening = panelOpening(storeRoot, undefined, "some-slug");

  assert.ok("refusal" in opening, "an owner key is required to name a space");
  if (!("refusal" in opening)) return;
  assert.ok(opening.refusal.length > 0);
});

test("panelOpening with neither owner key nor slug returns a refusal sentence", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac4c-"));

  const opening = panelOpening(storeRoot, undefined, undefined);

  assert.ok("refusal" in opening);
});
