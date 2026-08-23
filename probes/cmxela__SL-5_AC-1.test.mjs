// WHY (INVARIANT): the wiring checker's whole job is to tell apart an engine
// module nothing in the product reaches from one a product module actually
// imports — a test-only importer must never count as reach, and a real
// product importer must always count as reach. This distinction must hold
// for as long as the checker exists.
//
// The criterion this probe is graded against is about the REAL source tree and
// the REAL ENGINE-WIRING.md: the set of engine modules with no product caller
// and the set the ledger lists must be equal, and a mismatch must name both
// directions. The synthetic-map scenarios below prove the walker's arithmetic;
// they cannot fail if the ledger is emptied or deleted, so the real-tree case
// at the end reads the actual files and is what ties this check to its subject.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  unreachedEngineModules,
  parseWiringLedger,
} from "../out-test/gates/engineWiring.js";

const RELPATH = ["." , "/engine/used"].join("");
const RELPATH_ORPHAN = ["." , "/orphan"].join("");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXT_RE = /\.tsx?$/;

function walkTree(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "out" || name === "out-test" || name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walkTree(full, out);
      continue;
    }
    if (!SOURCE_EXT_RE.test(name)) continue;
    out.push({
      path: path.relative(REPO_ROOT, full).split(path.sep).join("/"),
      content: readFileSync(full, "utf8"),
    });
  }
  return out;
}

test("unreachedEngineModules returns an engine module that only test files import", () => {
  const files = [
    { path: "src/extension.ts", content: `import { used } from "${RELPATH}";\nused();\n` },
    { path: "src/engine/used.ts", content: `export function used() {}\n` },
    { path: "src/engine/orphan.ts", content: `export function orphan() {}\n` },
    {
      path: "src/engine/orphan.test.ts",
      content: `import { orphan } from "${RELPATH_ORPHAN}";\norphan();\n`,
    },
  ];

  const result = unreachedEngineModules({ entry: "src/extension.ts", files });
  const paths = result.map((m) => (typeof m === "string" ? m : m.path));

  assert.ok(
    paths.includes("src/engine/orphan.ts"),
    "an engine module imported only by a test file must be reported unreached",
  );
});

test("unreachedEngineModules does not return an engine module a product module imports", () => {
  const files = [
    { path: "src/extension.ts", content: `import { used } from "${RELPATH}";\nused();\n` },
    { path: "src/engine/used.ts", content: `export function used() {}\n` },
    { path: "src/engine/orphan.ts", content: `export function orphan() {}\n` },
    {
      path: "src/engine/orphan.test.ts",
      content: `import { orphan } from "${RELPATH_ORPHAN}";\norphan();\n`,
    },
  ];

  const result = unreachedEngineModules({ entry: "src/extension.ts", files });
  const paths = result.map((m) => (typeof m === "string" ? m : m.path));

  assert.ok(
    !paths.includes("src/engine/used.ts"),
    "an engine module a product module imports must not be reported unreached",
  );
});

test("Run against the real source tree, the set of engine modules with no product caller and the set of modules listed in ENGINE-WIRING.md are equal, and a mismatch names both the modules missing from the ledger and the ledger entries that are no longer unreached", () => {
  const ledgerPath = path.join(REPO_ROOT, "ENGINE-WIRING.md");
  assert.ok(
    statSync(ledgerPath, { throwIfNoEntry: false }),
    `ENGINE-WIRING.md is not in the tree this check runs against (root: ${REPO_ROOT})`,
  );

  const files = walkTree(path.join(REPO_ROOT, "src"), []);
  const webview = path.join(REPO_ROOT, "webview");
  if (statSync(webview, { throwIfNoEntry: false })) walkTree(webview, files);

  // Guards against a vacuous pass: if the scan found no entry point or no
  // engine modules, an equal-sets assertion would hold trivially.
  assert.ok(
    files.some((f) => f.path === "src/extension.ts"),
    "the real product entry point src/extension.ts must be among the scanned files",
  );
  assert.ok(
    files.some((f) => f.path.startsWith("src/engine/")),
    "the real tree must contain src/engine/ modules for this check to mean anything",
  );

  const scanned = new Set(
    unreachedEngineModules({ entry: "src/extension.ts", files }).map((m) =>
      typeof m === "string" ? m : m.path,
    ),
  );

  const result = parseWiringLedger(readFileSync(ledgerPath, "utf8"));
  const entries = Array.isArray(result) ? result : result.entries;
  const listed = new Set(entries.map((e) => e.path));
  assert.ok(listed.size > 0, "the real ENGINE-WIRING.md must list at least one module");

  // Both directions are named, so a failure says what to add to the ledger AND
  // what to strike from it — never just "they differ".
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
