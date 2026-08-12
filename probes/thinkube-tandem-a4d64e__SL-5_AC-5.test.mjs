// WHY (INVARIANT): ENGINE-WIRING.md must never list a module that already
// has a product caller — defectStats, rtkRewrite, workerModel,
// approvalStore, acceptOrder, verifyOracle, oracleStore, defectLog,
// orchestratorCore, testImpactFootprint, parallelSlices, store/frontmatter,
// WorktreeService, worktreeProvision, provisionDetect, promptTemplates,
// StoreSyncService, host/* — because that would misrepresent an already-
// wired module as needing a verdict. Must keep holding as the ledger grows.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");

const ALREADY_WIRED = [
  "defectStats",
  "rtkRewrite",
  "workerModel",
  "approvalStore",
  "acceptOrder",
  "verifyOracle",
  "oracleStore",
  "defectLog",
  "orchestratorCore",
  "testImpactFootprint",
  "parallelSlices",
  "store/frontmatter",
  "WorktreeService",
  "worktreeProvision",
  "provisionDetect",
  "promptTemplates",
  "StoreSyncService",
];

test("ENGINE-WIRING.md lists no module that already has a product caller outside src/engine", () => {
  const text = fs.readFileSync(ledgerPath, "utf8");
  for (const mod of ALREADY_WIRED) {
    assert.ok(
      !text.includes(mod),
      `"${mod}" already has a product caller and must not appear in ENGINE-WIRING.md's module list`,
    );
  }
  assert.ok(
    !/\bhost\//.test(text),
    "host/* modules already have product callers and must not appear in ENGINE-WIRING.md's module list",
  );
});
