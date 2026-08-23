// WHY (CRITERION): every entry in the REAL ENGINE-WIRING.md must parse to a
// verdict drawn from wire, retire or fold, and to a non-empty reasoning
// sentence. The subject of this promise is the ledger file in the tree, so
// this check reads that file — a hand-written markdown fixture would prove the
// parser's arithmetic while leaving the actual ledger unexamined.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWiringLedger } from "../out-test/gates/engineWiring.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const KNOWN_VERDICTS = ["wire", "retire", "fold"];

test("Every entry in the real ENGINE-WIRING.md parses to a verdict drawn from wire, retire or fold and a non-empty reasoning sentence", () => {
  const ledgerPath = path.join(REPO_ROOT, "ENGINE-WIRING.md");
  assert.ok(
    statSync(ledgerPath, { throwIfNoEntry: false }),
    `ENGINE-WIRING.md is not in the tree this check runs against (root: ${REPO_ROOT})`,
  );

  const ledgerText = readFileSync(ledgerPath, "utf8");
  const result = parseWiringLedger(ledgerText);
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result)
    ? []
    : (result.errors ?? result.problems ?? []);

  assert.ok(
    entries.length > 0,
    "the real ENGINE-WIRING.md must parse to at least one entry",
  );

  assert.deepEqual(
    problems,
    [],
    `the real ENGINE-WIRING.md has entries the parser could not accept: ${JSON.stringify(problems)}`,
  );

  const badVerdicts = entries
    .filter((e) => !KNOWN_VERDICTS.includes(e.verdict))
    .map((e) => `${e.path} → "${e.verdict}"`);
  assert.deepEqual(
    badVerdicts,
    [],
    `these real ledger entries carry a verdict outside wire/retire/fold: ${badVerdicts.join(", ")}`,
  );

  const blankReasons = entries
    .filter((e) => !e.reason || !e.reason.trim())
    .map((e) => e.path);
  assert.deepEqual(
    blankReasons,
    [],
    `these real ledger entries carry an empty reasoning sentence: ${blankReasons.join(", ")}`,
  );
});
