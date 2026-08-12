// WHY (TRANSITION): proves ENGINE-WIRING.md now exists at the repository
// root and names every one of the eleven engine modules that (as of this
// slice) nothing outside src/engine calls — openingGate, auditorRunner,
// acSignature, specApprovalHash, methodology/specChange, dispatchGuard,
// concurrencyLock, provisioningLeak, retiredSymbolFootprint, shipFresh and
// verificationRunnable. Before this slice the ledger did not exist at all;
// its job is done once the file lands with the full list.
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

test("ENGINE-WIRING.md exists at the repository root and lists all eleven unwired engine modules", () => {
  assert.ok(fs.existsSync(ledgerPath), "ENGINE-WIRING.md must exist at the repository root");
  const text = fs.readFileSync(ledgerPath, "utf8");
  for (const mod of EXPECTED_MODULES) {
    assert.ok(
      text.includes(mod),
      `ENGINE-WIRING.md must mention "${mod}" — it is one of the modules with no product caller outside src/engine`,
    );
  }
});
