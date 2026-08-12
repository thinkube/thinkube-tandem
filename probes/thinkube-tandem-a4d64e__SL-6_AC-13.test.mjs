// WHY (TRANSITION): getting-started.adoc's "Each repository gets its own
// space" implied a single panel replaces whatever was open, which stopped
// being true once thinking spaces are the unit and each opens its own
// tab. This proves that sentence was corrected to name thinking spaces
// and their tabs instead of repositories and a single panel. Its job is
// done once the page no longer implies "one panel replaces what was
// open".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test('getting-started.adoc no longer says "Each repository gets its own space"', () => {
  const text = fs.readFileSync(
    path.join(repoRoot, "docs", "modules", "ROOT", "pages", "getting-started.adoc"),
    "utf8",
  );
  assert.ok(
    !/Each repository gets its own space\.?/i.test(text),
    "the old repository-scoped, single-panel-implying sentence must be gone",
  );
});

test("getting-started.adoc's Open the space section names thinking spaces and their own tabs", () => {
  const text = fs.readFileSync(
    path.join(repoRoot, "docs", "modules", "ROOT", "pages", "getting-started.adoc"),
    "utf8",
  );
  const openSection = text.split(/^==\s+/m).find((s) => /^Open the space/i.test(s)) ?? "";
  assert.ok(openSection, "an 'Open the space' section must exist");
  assert.ok(
    /thinking space/i.test(openSection),
    "the section must talk about thinking spaces, not only repositories",
  );
  assert.ok(
    /tab/i.test(openSection),
    "the section must talk about tabs — each thinking space opens its own, not a single replacing panel",
  );
});
