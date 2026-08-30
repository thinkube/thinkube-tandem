/**
 * TRANSITION — proves the new panelOpening seam exists and agrees with
 * spaceTitle: given a real owner key and slug it must return the key
 * "<ownerKey>/<slug>" and the same title spaceTitle would give for that
 * space, so the extension's open-tab path can stop inventing its own key
 * and title.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { panelOpening, spaceTitle } from "./spaceOps";

test("panelOpening with an owner key and a slug returns the key and matching title", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac3-"));
  const dir = path.join(storeRoot, "spaces", "repo1", "plugin-delivery");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name.txt"), "Plugin delivery\n");

  const opening = panelOpening(storeRoot, "repo1", "plugin-delivery");

  assert.ok(!("refusal" in opening), "a real owner key and slug open a tab, not a refusal");
  if ("refusal" in opening) return;
  assert.equal(opening.key, "repo1/plugin-delivery", 'the key is exactly "<ownerKey>/<slug>"');
  assert.equal(
    opening.title,
    spaceTitle(storeRoot, "repo1", "plugin-delivery"),
    "the title agrees with spaceTitle for the same space",
  );
});

test("panelOpening falls back to the slug as words when no name.txt exists", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac3b-"));
  const dir = path.join(storeRoot, "spaces", "repo9", "rebrand-work");
  fs.mkdirSync(dir, { recursive: true });

  const opening = panelOpening(storeRoot, "repo9", "rebrand-work");

  assert.ok(!("refusal" in opening));
  if ("refusal" in opening) return;
  assert.equal(opening.key, "repo9/rebrand-work");
  assert.equal(opening.title, "Rebrand work");
});
