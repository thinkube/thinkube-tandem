/**
 * INVARIANT — when no name was ever recorded, the tab still opens under
 * plain words: spaceTitle must read the slug back as words, with dashes
 * and underscores turned to spaces and the first letter capitalised, so a
 * space made before naming still gets a readable title instead of a raw
 * slug like "docs-duty-and-tabs".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spaceTitle } from "./spaceOps";

test("spaceTitle on a space with no name.txt returns the slug as plain words", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac2-"));
  const dir = path.join(storeRoot, "spaces", "repo1", "docs-duty-and-tabs");
  fs.mkdirSync(dir, { recursive: true });
  // No name.txt written — the slug alone must carry the title.

  const title = spaceTitle(storeRoot, "repo1", "docs-duty-and-tabs");

  assert.equal(title, "Docs duty and tabs", "dashes become spaces and the first letter is capitalised");
  assert.equal(/[-_]/.test(title), false, "no dash or underscore is left in the title");
});

test("spaceTitle on a slug with underscores returns plain words too", () => {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac2b-"));
  const dir = path.join(storeRoot, "spaces", "repo1", "release_notes_draft");
  fs.mkdirSync(dir, { recursive: true });

  const title = spaceTitle(storeRoot, "repo1", "release_notes_draft");

  assert.equal(title, "Release notes draft", "underscores become spaces just like dashes");
});
