/**
 * Every entry in the real ENGINE-WIRING.md parses to a verdict drawn from
 * wire, retire or fold and a non-empty reasoning sentence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parseWiringLedger } from "./engineWiring";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("every real ledger entry carries a valid verdict and a non-empty reason", () => {
  const result = parseWiringLedger(readFileSync(path.join(REPO_ROOT, "ENGINE-WIRING.md"), "utf8"));
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result)
    ? []
    : ((result as any).errors ?? (result as any).problems ?? []);

  assert.equal(
    problems.length,
    0,
    `ENGINE-WIRING.md has unparseable entries: ${JSON.stringify(problems)}`,
  );

  for (const entry of entries) {
    assert.ok(
      entry.verdict === "wire" || entry.verdict === "retire" || entry.verdict === "fold",
      `${entry.path} carries an invalid verdict "${entry.verdict}"`,
    );
    assert.ok(
      entry.reason.trim().length > 0,
      `${entry.path} carries an empty reasoning sentence`,
    );
  }
});
