// WHY (INVARIANT): every entry in the real ENGINE-WIRING.md must parse to
// one of the three closed verdicts (wire, retire, fold) with a non-empty
// reasoning sentence — the ledger is only trustworthy as a source of truth
// if every line in it is well-formed, checked the same way the synthetic
// parser tests check a fabricated ledger.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWiringLedger } from "../out-test/gates/engineWiring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");
const VERDICTS = new Set(["wire", "retire", "fold"]);

test("every entry in the real ENGINE-WIRING.md parses to a closed verdict and a non-empty reasoning sentence", () => {
  const ledgerText = fs.readFileSync(path.join(repo, "ENGINE-WIRING.md"), "utf8");
  const parsed = parseWiringLedger(ledgerText);
  assert.ok(parsed.ok, parsed.ok ? "" : `ENGINE-WIRING.md failed to parse: ${parsed.reason}`);
  assert.ok(parsed.entries.length > 0, "the ledger lists at least one module");
  for (const entry of parsed.entries) {
    assert.ok(
      VERDICTS.has(entry.verdict),
      `${entry.module} carries verdict "${entry.verdict}", not one of wire, retire, fold`,
    );
    assert.ok(
      typeof entry.reason === "string" && entry.reason.trim().length > 0,
      `${entry.module} carries an empty or missing reasoning sentence`,
    );
  }
});
