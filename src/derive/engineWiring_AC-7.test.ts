/**
 * TRANSITION: every row ENGINE-WIRING.md carries must name a real module
 * under src/engine/ in this repository — a ledger row about a module that
 * does not exist would be judging nothing. This test's job is done once
 * the ledger is written with only real, existing engine paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWiringLedger } from "./engineWiring";

const repo = path.resolve(__dirname, "..", "..");

test("every row parseWiringLedger reads out of ENGINE-WIRING.md names a path that exists under src/engine/", () => {
  const ledgerText = fs.readFileSync(path.join(repo, "ENGINE-WIRING.md"), "utf8");
  const rows = parseWiringLedger(ledgerText);
  assert.ok(rows.length > 0, "the ledger holds at least one row");
  const missing = rows.filter((r) => {
    if (!r.module.startsWith("src/engine/")) return true;
    return !fs.existsSync(path.join(repo, r.module));
  });
  assert.deepEqual(
    missing.map((r) => r.module),
    [],
    "every ledger row must name a path that exists under src/engine/",
  );
});
