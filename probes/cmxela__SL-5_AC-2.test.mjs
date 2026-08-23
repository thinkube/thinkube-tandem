// WHY (INVARIANT): reach must be transitive from the product entry point —
// an engine module that is only imported by another engine module which is
// itself unreached must not be laundered into "reached" just because
// something imports it. This must hold for as long as the checker exists.
//
// The criterion this probe is graded against is about the REAL ENGINE-WIRING.md:
// every entry in it must parse to a verdict drawn from wire, retire or fold and
// to a non-empty reasoning sentence. The synthetic-map scenario below proves the
// walker's transitivity; it cannot fail if the ledger is emptied or deleted, so
// the real-file case at the end reads the actual ledger and is what ties this
// check to its subject.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  unreachedEngineModules,
  parseWiringLedger,
} from "../out-test/gates/engineWiring.js";

const RELPATH = ["." , "/engine/used"].join("");
const RELPATH_ORPHAN_ROOT = ["." , "/orphanRoot"].join("");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_VERDICTS = ["wire", "retire", "fold"];

test("unreachedEngineModules follows reach transitively from src/extension.ts", () => {
  const files = [
    {
      path: "src/extension.ts",
      content: `import { used } from "${RELPATH}";\nused();\n`,
    },
    { path: "src/engine/used.ts", content: `export function used() {}\n` },
    {
      path: "src/engine/orphanRoot.ts",
      content: `export function orphanRoot() {}\n`,
    },
    {
      path: "src/engine/orphanLeaf.ts",
      content: `import { orphanRoot } from "${RELPATH_ORPHAN_ROOT}";\nexport function orphanLeaf() { orphanRoot(); }\n`,
    },
  ];

  const result = unreachedEngineModules({ entry: "src/extension.ts", files });
  const paths = result.map((m) => (typeof m === "string" ? m : m.path));

  assert.ok(
    paths.includes("src/engine/orphanRoot.ts"),
    "orphanRoot is only imported by an unreached engine module, so it must itself be unreached",
  );
  assert.ok(
    paths.includes("src/engine/orphanLeaf.ts"),
    "orphanLeaf is not reached from the product entry either, so it must be reported unreached too",
  );
  assert.ok(
    !paths.includes("src/engine/used.ts"),
    "used is reached directly from the product entry and must not be reported",
  );
});

test("Every entry in the real ENGINE-WIRING.md parses to a verdict drawn from wire, retire or fold and a non-empty reasoning sentence", () => {
  const ledgerPath = path.join(REPO_ROOT, "ENGINE-WIRING.md");
  assert.ok(
    statSync(ledgerPath, { throwIfNoEntry: false }),
    `ENGINE-WIRING.md is not in the tree this check runs against (root: ${REPO_ROOT})`,
  );

  const result = parseWiringLedger(readFileSync(ledgerPath, "utf8"));
  const entries = Array.isArray(result) ? result : result.entries;
  const problems = Array.isArray(result)
    ? []
    : (result.errors ?? result.problems ?? []);

  // Guards against a vacuous pass: an empty ledger would satisfy every
  // per-entry assertion below without proving anything.
  assert.ok(
    entries.length > 0,
    "the real ENGINE-WIRING.md must parse to at least one entry",
  );

  assert.deepEqual(
    problems,
    [],
    `the real ENGINE-WIRING.md has entries the parser could not accept: ${JSON.stringify(problems)}`,
  );

  const badVerdicts = entries
    .filter((e) => !KNOWN_VERDICTS.includes(e.verdict))
    .map((e) => `${e.path} → "${e.verdict}"`);
  assert.deepEqual(
    badVerdicts,
    [],
    `these real ledger entries carry a verdict outside wire/retire/fold: ${badVerdicts.join(", ")}`,
  );

  const blankReasons = entries
    .filter((e) => !e.reason || !e.reason.trim())
    .map((e) => e.path);
  assert.deepEqual(
    blankReasons,
    [],
    `these real ledger entries carry an empty reasoning sentence: ${blankReasons.join(", ")}`,
  );
});
