/**
 * INVARIANT: parseWiringLedger reads a ledger row back into its three
 * parts — the module's repo-relative path, its verdict word, and its
 * non-empty reason sentence — so ENGINE-WIRING.md is a source read back,
 * not prose trusted on faith. Must hold forever: the ledger's whole point
 * is that it can be parsed, not just written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWiringLedger } from "./engineWiring";

test("parseWiringLedger returns one row carrying path, verdict and reason for a one-entry ledger", () => {
  const markdown = `# Engine wiring

| Module | Verdict | Reason |
| --- | --- | --- |
| src/engine/core/watchdog.ts | wire | src/run/watchdog.ts already does this job in v2. |
`;
  const rows = parseWiringLedger(markdown);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].module, "src/engine/core/watchdog.ts");
  assert.equal(rows[0].verdict, "wire");
  assert.ok(rows[0].reason.trim().length > 0, "the reason sentence is non-empty");
});
