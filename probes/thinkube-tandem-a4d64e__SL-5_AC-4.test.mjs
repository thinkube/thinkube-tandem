// WHY (INVARIANT): for every module ENGINE-WIRING.md lists, grepping src/
// outside src/engine must return no importer — the ledger's "no product
// caller" claim must hold as written against the actual tree, not just as
// an assertion on paper. This must keep holding: if a module in the ledger
// ever gains a caller outside src/engine, the claim becomes false and this
// test must fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const engineRoot = path.join(srcRoot, "engine");

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

function listFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (["node_modules", ".git", "out", "out-test", "build", "dist"].includes(name)) continue;
      listFiles(p, out);
    } else if (/\.[cm]?[jt]sx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

test("grep across src/ outside src/engine finds no importer for any module ENGINE-WIRING.md lists", () => {
  const outsideFiles = listFiles(srcRoot).filter((p) => !p.startsWith(engineRoot + path.sep));
  for (const mod of EXPECTED_MODULES) {
    const moduleBasename = mod.split("/").pop();
    const importerRe = new RegExp(
      `from\\s+["'][^"']*engine[^"']*${moduleBasename}["']|require\\(["'][^"']*engine[^"']*${moduleBasename}["']\\)`,
    );
    const importers = outsideFiles.filter((p) => importerRe.test(fs.readFileSync(p, "utf8")));
    assert.deepEqual(
      importers.map((p) => path.relative(repoRoot, p)),
      [],
      `"${mod}" must have no importer outside src/engine`,
    );
  }
});
