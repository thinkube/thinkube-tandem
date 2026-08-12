// WHY (INVARIANT): every module ENGINE-WIRING.md lists must carry exactly
// one verdict — wire, retire or fold — plus one sentence of reasoning, so
// the ledger is never ambiguous about what happens to a given module. This
// must keep holding as the ledger grows: a future entry that carries two
// verdicts (or none) breaks the reader's ability to act on the file.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");

const EXPECTED_MODULES = [
  "openingGate",
  "auditorRunner",
  "acSignature",
  "specApprovalHash",
  "methodology/specChange",
  "dispatchGuard",
  "concurrencyLock",
  "provisioningLeak",
  "retiredSymbolFootprint",
  "shipFresh",
  "verificationRunnable",
];

const VERDICT_RE = /\b(wire|retire|fold)\b/i;

// Split the ledger into per-module sections: from a module's own heading/
// mention up to (but excluding) the next expected module's mention, so each
// module's verdict and reasoning are checked against only its own text.
function sectionFor(text, mod, allMods) {
  const start = text.indexOf(mod);
  assert.ok(start >= 0, `"${mod}" must appear in ENGINE-WIRING.md`);
  let end = text.length;
  for (const other of allMods) {
    if (other === mod) continue;
    const idx = text.indexOf(other, start + mod.length);
    if (idx >= 0 && idx < end) end = idx;
  }
  return text.slice(start, end);
}

test("every listed module carries exactly one verdict (wire/retire/fold) and one sentence of reasoning", () => {
  const text = fs.readFileSync(ledgerPath, "utf8");
  for (const mod of EXPECTED_MODULES) {
    const section = sectionFor(text, mod, EXPECTED_MODULES);
    const verdicts = section.match(new RegExp(VERDICT_RE, "gi")) ?? [];
    assert.equal(
      verdicts.length,
      1,
      `"${mod}" must carry exactly one verdict word (wire/retire/fold), found: ${JSON.stringify(verdicts)}`,
    );
    // Reasoning: at least one non-empty sentence-like clause beyond the verdict word itself.
    const withoutVerdict = section.replace(VERDICT_RE, "").trim();
    assert.ok(
      withoutVerdict.replace(/[#*\-\s]/g, "").length > 20,
      `"${mod}" must carry a sentence of reasoning alongside its verdict`,
    );
  }
});
