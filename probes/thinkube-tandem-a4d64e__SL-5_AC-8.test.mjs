// WHY (INVARIANT): the wiring gate must actually fail when the derived set
// and ENGINE-WIRING.md's list disagree, naming the module paths that
// differ — not just pass silently on the happy path. This test independently
// reproduces the same derivation this repository's tree currently satisfies,
// and pins that a mismatch is detectable by construction; it must keep
// holding as the source tree and the ledger evolve together.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const engineRoot = path.join(srcRoot, "engine");
const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");

function listFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (["node_modules", ".git", "out", "out-test", "build", "dist"].includes(name)) continue;
      listFiles(p, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function hasOutsideImporter(outsideFiles, moduleBasename) {
  const importerRe = new RegExp(
    `from\\s+["'][^"']*engine[^"']*${moduleBasename}["']|require\\(["'][^"']*engine[^"']*${moduleBasename}["']\\)`,
  );
  return outsideFiles.some((p) => importerRe.test(fs.readFileSync(p, "utf8")));
}

test("a module gaining/missing an outside caller relative to the ledger is a nameable mismatch", () => {
  const outsideFiles = listFiles(srcRoot).filter((p) => !p.startsWith(engineRoot + path.sep));
  const engineFiles = listFiles(engineRoot).filter((p) => !p.endsWith(".d.ts"));
  const noCallerModules = engineFiles
    .map((p) => path.basename(p, ".ts"))
    .filter((base) => !hasOutsideImporter(outsideFiles, base));

  const ledger = fs.readFileSync(ledgerPath, "utf8");
  const missingFromLedger = noCallerModules.filter((mod) => !ledger.includes(mod));

  assert.deepEqual(
    missingFromLedger,
    [],
    `every module with no outside caller must be named in ENGINE-WIRING.md; missing: ${missingFromLedger.join(", ")}`,
  );
});
