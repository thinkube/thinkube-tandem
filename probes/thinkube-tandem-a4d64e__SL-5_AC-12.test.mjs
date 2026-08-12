// WHY (TRANSITION): importSmoke.test.ts's docblock must name ENGINE-WIRING.md
// as the register of which engine modules are still unwired, so a reader
// lands on the one ledger instead of re-deriving the answer from the test
// file itself. Its job is done once the docblock points there.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importSmokePath = path.join(repoRoot, "src", "engine", "importSmoke.test.ts");

test("importSmoke.test.ts's docblock names ENGINE-WIRING.md as the register of unwired engine modules", () => {
  const text = fs.readFileSync(importSmokePath, "utf8");
  const docblockMatch = text.match(/\/\*\*[\s\S]*?\*\//);
  assert.ok(docblockMatch, "importSmoke.test.ts must open with a docblock");
  assert.match(
    docblockMatch[0],
    /ENGINE-WIRING\.md/,
    "the docblock must name ENGINE-WIRING.md as where unwired-module status is tracked",
  );
});
