// WHY (INVARIANT): ENGINE-WIRING.md must state, on its own face, that it is
// the register of wiring verdicts — so a reader who lands on the file (not
// on DECISIONS.md) knows this is the one file to change when a module gets
// wired. Must keep holding as the ledger's contents change: the
// self-description is what makes it the single source of truth rather than
// an unlabeled list.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");

test("ENGINE-WIRING.md states that it is the register of wiring verdicts", () => {
  const text = fs.readFileSync(ledgerPath, "utf8");
  assert.ok(
    /register/i.test(text) && /verdict/i.test(text),
    "ENGINE-WIRING.md must describe itself as the register of wiring verdicts",
  );
});
