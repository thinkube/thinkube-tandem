// WHY (TRANSITION): the published docs must not still describe the
// documentation obligation as arising from a declared docs/ touchpoint —
// that phrase is retired wherever the rule is stated, across every page.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const PAGES = [
  "docs/modules/ROOT/pages/gates.adoc",
  "docs/modules/ROOT/pages/getting-started.adoc",
  "docs/modules/ROOT/pages/configuration.adoc",
];

test('searching the pages for "declared documentation obligation" returns no line describing it as arising from a docs/ touchpoint', () => {
  for (const rel of PAGES) {
    const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const offending = text
      .split(/\r?\n/)
      .filter((l) => /declared documentation obligation/i.test(l));
    assert.equal(
      offending.length,
      0,
      `${rel} still carries a "declared documentation obligation" line: ${JSON.stringify(offending)}`,
    );
  }
});
