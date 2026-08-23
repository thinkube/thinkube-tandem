// WHY (CRITERION): run against the REAL source tree, the set of engine modules
// with no product caller must equal the set of modules listed in the REAL
// ENGINE-WIRING.md, and a mismatch must name both directions — the modules
// missing from the ledger, and the ledger entries that are no longer unreached.
//
// This check reads the actual files of this repository. A synthetic file map
// would prove the walker's arithmetic while saying nothing about whether the
// ledger in the tree is in fact complete, which is the whole promise here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  unreachedEngineModules,
  parseWiringLedger,
} from "../out-test/gates/engineWiring.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const SOURCE_EXT_RE = /\.tsx?$/;

function pathOf(m) {
  return typeof m === "string" ? m : m.path;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "out" || name === "out-test" || name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!SOURCE_EXT_RE.test(name)) continue;
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join("/");
    out.push({ path: rel, content: readFileSync(full, "utf8") });
  }
}

test("Run against the real source tree, the set of engine modules with no product caller and the set of modules listed in ENGINE-WIRING.md are equal, and a mismatch names both the modules missing from the ledger and the ledger entries that are no longer unreached", () => {
  const ledgerPath = path.join(REPO_ROOT, "ENGINE-WIRING.md");
  assert.ok(
    statSync(ledgerPath, { throwIfNoEntry: false }),
    `ENGINE-WIRING.md is not in the tree this check runs against (root: ${REPO_ROOT})`,
  );

  const files = [];
  walk(path.join(REPO_ROOT, "src"), files);
  const webview = path.join(REPO_ROOT, "webview");
  if (statSync(webview, { throwIfNoEntry: false })) walk(webview, files);

  assert.ok(
    files.some((f) => f.path === "src/extension.ts"),
    "the real product entry point src/extension.ts must be among the scanned files",
  );
  assert.ok(
    files.filter((f) => f.path.startsWith("src/engine/")).length > 0,
    "the real tree must contain src/engine/ modules for this check to mean anything",
  );

  const scanned = new Set(
    unreachedEngineModules({ entry: "src/extension.ts", files }).map(pathOf),
  );

  const ledgerText = readFileSync(ledgerPath, "utf8");
  const result = parseWiringLedger(ledgerText);
  const entries = Array.isArray(result) ? result : result.entries;
  const listed = new Set(entries.map((e) => e.path));

  assert.ok(listed.size > 0, "the real ENGINE-WIRING.md must list at least one module");

  // Both directions of the mismatch are named, so a failure says what to add
  // to the ledger AND what to strike from it — never just "they differ".
  const missingFromLedger = [...scanned].filter((p) => !listed.has(p)).sort();
  const staleInLedger = [...listed].filter((p) => !scanned.has(p)).sort();

  assert.deepEqual(
    { missingFromLedger, staleInLedger },
    { missingFromLedger: [], staleInLedger: [] },
    `ENGINE-WIRING.md is out of step with the real tree.\n` +
      `unreached engine modules missing from the ledger: ${missingFromLedger.join(", ") || "(none)"}\n` +
      `ledger entries that are no longer unreached (now wired): ${staleInLedger.join(", ") || "(none)"}`,
  );
});
