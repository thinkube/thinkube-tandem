// WHY (TRANSITION): the-space.adoc used to describe the space as a single
// full editor panel per repository. This proves the page was rewritten to
// describe the real shape: each thinking space opens its OWN editor tab
// carrying that space's name, and several can be open side by side. Its
// job is done once the page text matches the shipped one-tab-per-space
// behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("the-space.adoc no longer describes one full-width panel per repository", () => {
  const text = fs.readFileSync(
    path.join(repoRoot, "docs", "modules", "ROOT", "pages", "the-space.adoc"),
    "utf8",
  );
  assert.ok(
    !/as a full editor panel/i.test(text),
    "the old 'renders … as a full editor panel' phrasing must be gone",
  );
});

test("the-space.adoc says each thinking space opens its own editor tab named for the space, and several can be open side by side", () => {
  const text = fs.readFileSync(
    path.join(repoRoot, "docs", "modules", "ROOT", "pages", "the-space.adoc"),
    "utf8",
  );
  const mentionsOwnTab = /own\s+(editor\s+)?tab/i.test(text) || /each\s+thinking\s+space\s+opens/i.test(text);
  assert.ok(mentionsOwnTab, "the page must say each thinking space opens its own editor tab");
  const namedForSpace = /tab.{0,80}(its|the space'?s|that space'?s)\s+name/i.test(text)
    || /carr(y|ies|ying).{0,40}name/i.test(text);
  assert.ok(namedForSpace, "the page must say the tab carries the space's name");
  const sideBySide = /side by side|several.{0,40}open|open at (the same time|once)/i.test(text);
  assert.ok(sideBySide, "the page must say several thinking-space tabs can be open at the same time");
});
