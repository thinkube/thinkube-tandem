// WHY (TRANSITION): this proves the real ENGINE-WIRING.md, once written,
// parses cleanly end to end — every entry must carry a verdict drawn from
// wire, retire or fold and a non-empty reasoning sentence. Its job is done
// once the ledger is written correctly; from then on it stands as the gate
// that catches a future entry landing with a bad or missing verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWiringLedger } from "../out-test/gates/engineWiring.js";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..");

test("every entry in the real ENGINE-WIRING.md parses to a valid verdict and a non-empty reason", () => {
  const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");
  assert.ok(
    fs.existsSync(ledgerPath),
    "ENGINE-WIRING.md must exist at the repo root for this check to run",
  );
  const md = fs.readFileSync(ledgerPath, "utf8");

  const result = parseWiringLedger(md);
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result) ? [] : result.errors || result.problems || [];

  assert.ok(entries.length > 0, "the real ledger must list at least one module");
  assert.deepEqual(
    problems,
    [],
    `ENGINE-WIRING.md must parse with no problems, found: ${JSON.stringify(problems)}`,
  );

  const validVerdicts = new Set(["wire", "retire", "fold"]);
  for (const entry of entries) {
    assert.ok(
      validVerdicts.has(entry.verdict),
      `entry ${entry.path} must carry a verdict of wire, retire or fold, got ${entry.verdict}`,
    );
    assert.ok(
      typeof entry.reason === "string" && entry.reason.trim() !== "",
      `entry ${entry.path} must carry a non-empty reasoning sentence`,
    );
  }
});
