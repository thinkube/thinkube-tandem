// WHY (INVARIANT): ENGINE-WIRING.md must stay complete against the real
// source tree — the set of engine modules the scan finds unreached and the
// set the ledger lists must always be equal, so a module going unreached
// (or getting wired) without a matching ledger edit is caught, not missed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { unreachedEngineModules, parseWiringLedger } from "../out-test/gates/engineWiring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");

function walkTs(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

function loadRepoFiles() {
  return walkTs(path.join(repo, "src")).map((abs) => ({
    path: path.relative(repo, abs).split(path.sep).join("/"),
    content: fs.readFileSync(abs, "utf8"),
  }));
}

test("the real tree's unreached engine modules equal the modules listed in ENGINE-WIRING.md", () => {
  const files = loadRepoFiles();
  const unreached = new Set(
    unreachedEngineModules({ files, productEntry: "src/extension.ts" }),
  );

  const ledgerText = fs.readFileSync(path.join(repo, "ENGINE-WIRING.md"), "utf8");
  const parsed = parseWiringLedger(ledgerText);
  assert.ok(parsed.ok, parsed.ok ? "" : `ENGINE-WIRING.md failed to parse: ${parsed.reason}`);
  const listed = new Set(parsed.entries.map((e) => e.module));

  const missingFromLedger = [...unreached].filter((m) => !listed.has(m));
  const noLongerUnreached = [...listed].filter((m) => !unreached.has(m));

  assert.deepEqual(
    missingFromLedger,
    [],
    `unreached engine modules missing from ENGINE-WIRING.md: ${missingFromLedger.join(", ")}`,
  );
  assert.deepEqual(
    noLongerUnreached,
    [],
    `ENGINE-WIRING.md entries no longer unreached (a product caller now reaches them): ${noLongerUnreached.join(", ")}`,
  );
});
