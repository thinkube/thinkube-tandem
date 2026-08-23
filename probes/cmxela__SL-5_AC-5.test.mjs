// WHY (TRANSITION): this proves ENGINE-WIRING.md, once written, stays
// complete against the real tree — the set of engine modules with no
// product caller and the set of modules the ledger lists must be equal, and
// a mismatch must name both the modules missing from the ledger and the
// ledger entries no longer unreached. Its job is done once the ledger
// exists and this check is wired up; from then on it stands as the gate
// that keeps the ledger honest as the tree changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { unreachedEngineModules, parseWiringLedger } from "../out-test/gates/engineWiring.js";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..");

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out-test" || entry.name === "out") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function readRepoFiles() {
  const srcDir = path.join(repoRoot, "src");
  const absPaths = walk(srcDir, []);
  return absPaths.map((abs) => ({
    path: path.relative(repoRoot, abs).split(path.sep).join("/"),
    content: fs.readFileSync(abs, "utf8"),
  }));
}

test("real tree: the set of unreached engine modules equals the set listed in ENGINE-WIRING.md", () => {
  const files = readRepoFiles();
  const unreached = unreachedEngineModules({ entry: "src/extension.ts", files });
  const unreachedPaths = new Set(
    unreached.map((m) => (typeof m === "string" ? m : m.path)),
  );

  const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");
  assert.ok(
    fs.existsSync(ledgerPath),
    "ENGINE-WIRING.md must exist at the repo root for this check to run",
  );
  const md = fs.readFileSync(ledgerPath, "utf8");
  const result = parseWiringLedger(md);
  const entries = Array.isArray(result) ? result : result.entries;
  const ledgerPaths = new Set(entries.map((e) => e.path));

  const missingFromLedger = [...unreachedPaths].filter((p) => !ledgerPaths.has(p));
  const noLongerUnreached = [...ledgerPaths].filter((p) => !unreachedPaths.has(p));

  assert.deepEqual(
    missingFromLedger,
    [],
    `engine modules unreached in the real tree but missing from ENGINE-WIRING.md: ${missingFromLedger.join(", ")}`,
  );
  assert.deepEqual(
    noLongerUnreached,
    [],
    `ENGINE-WIRING.md entries that are no longer unreached in the real tree: ${noLongerUnreached.join(", ")}`,
  );
});
