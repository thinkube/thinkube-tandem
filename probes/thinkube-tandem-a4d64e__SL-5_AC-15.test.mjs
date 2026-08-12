// WHY (TRANSITION): DECISIONS.md's retired-symbol entry must name
// ENGINE-WIRING.md as where that module's verdict now lives, and state the
// same verdict in the same words — the wiring ledger becomes the one
// register, not a second drifting copy. Its job is done once DECISIONS.md
// points at the ledger instead of restating the verdict independently.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const decisionsPath = path.join(repoRoot, "DECISIONS.md");
const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");

test("DECISIONS.md's retired-symbol entry names ENGINE-WIRING.md and states the same verdict in the same words", () => {
  const decisions = fs.readFileSync(decisionsPath, "utf8");
  const ledger = fs.readFileSync(ledgerPath, "utf8");

  const entryMatch = decisions.match(/[^\n]*retired-symbol[^\n]*(\n[^\n#-][^\n]*)*/i);
  assert.ok(entryMatch, "DECISIONS.md must still have a retired-symbol importer gate entry");
  const entry = entryMatch[0];

  assert.match(entry, /ENGINE-WIRING\.md/, "the entry must name ENGINE-WIRING.md as where the verdict lives");

  const ledgerIdx = ledger.indexOf("retiredSymbolFootprint");
  assert.ok(ledgerIdx >= 0, "ENGINE-WIRING.md must carry a retiredSymbolFootprint entry to point at");
  const ledgerVerdictMatch = ledger.slice(ledgerIdx, ledgerIdx + 400).match(/\b(wire|retire|fold)\b/i);
  assert.ok(ledgerVerdictMatch, "ENGINE-WIRING.md's retiredSymbolFootprint entry must carry a verdict word");

  assert.match(
    entry,
    new RegExp(ledgerVerdictMatch[0], "i"),
    "DECISIONS.md's entry must state the same verdict word as ENGINE-WIRING.md",
  );
});
