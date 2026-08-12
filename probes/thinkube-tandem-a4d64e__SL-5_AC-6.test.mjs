// WHY (INVARIANT): the retired-symbol gate's entry in ENGINE-WIRING.md must
// agree with the verdict DECISIONS.md already recorded for it ("The
// retired-symbol importer gate stays unwired until grounding grows a
// `retires` declaration...") rather than silently contradicting the
// standing decision record. Must keep holding: a future edit to either file
// that disagrees with the other is a defect, not a style choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");
const decisionsPath = path.join(repoRoot, "DECISIONS.md");

test("ENGINE-WIRING.md's retiredSymbolFootprint verdict agrees with DECISIONS.md's recorded decision", () => {
  const ledger = fs.readFileSync(ledgerPath, "utf8");
  const decisions = fs.readFileSync(decisionsPath, "utf8");

  assert.ok(
    /stays unwired/i.test(decisions) && /retired-symbol/i.test(decisions),
    "DECISIONS.md must still record that the retired-symbol importer gate stays unwired",
  );

  const idx = ledger.indexOf("retiredSymbolFootprint");
  assert.ok(idx >= 0, "ENGINE-WIRING.md must have a retiredSymbolFootprint entry");
  const section = ledger.slice(idx, idx + 600);
  assert.match(
    section,
    /\b(retire|fold)\b/i,
    "retiredSymbolFootprint's verdict must agree with DECISIONS.md's 'stays unwired' stance — never 'wire'",
  );
  assert.ok(
    !/\bwire\b/i.test(section.split(/retire|fold/i)[0] ?? section),
    "retiredSymbolFootprint must not carry a 'wire' verdict — that would contradict DECISIONS.md",
  );
});
