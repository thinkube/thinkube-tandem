/**
 * Unit tests for `findUncoveredImporters` (SP-6/15, TEP-6) — the pure, injectable
 * reverse-dependency check that refuses a symbol-retirement whose importers aren't all
 * footprinted. node:test + node:assert; run via `npm test`.
 *
 * The core is a total function over `{ retiredSymbols, footprintPaths, repoFiles }` (files
 * injected as path→content, never read from disk here). These tests pin the four behaviours the
 * Spec's precision/short-circuit constraints require, using synthetic file maps only — no disk,
 * no board, no model:
 *
 *   1. specifier match     — a NAMED import of a retired symbol in an UNfootprinted file is a
 *                            violation `{ symbol, importer }`.
 *   2. footprint exemption — the same importing file, once listed in `footprintPaths`, is exempt
 *                            (the slice edits it) → no violation.
 *   3. shadowed-local      — a file that merely declares a local `const X` with NO import of the
 *                            retired export is NOT a violation (specifier-based, not
 *                            bare-identifier).
 *   4. empty short-circuit — `retiredSymbols: []` yields `[]` WITHOUT scanning any file (proven by
 *                            a repoFile whose `content` throws if it is ever read).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findUncoveredImporters,
  type RepoFile,
  type RetiredSymbolViolation,
} from "./retiredSymbolFootprint";

test("a named import of a retired symbol in an unfootprinted file is a violation", () => {
  const repoFiles: RepoFile[] = [
    {
      path: "src/acceptance/SP-6_3_AC-2.test.ts",
      content: [
        `import { APPROVAL_TTL_MS } from "../services/approvalToken";`,
        "",
        "const ttl = APPROVAL_TTL_MS;",
        "",
      ].join("\n"),
    },
  ];

  const violations = findUncoveredImporters({
    retiredSymbols: ["APPROVAL_TTL_MS"],
    footprintPaths: ["src/services/approvalToken.ts"], // the file that HOLDS the symbol, not the importer
    repoFiles,
  });

  assert.deepEqual(violations, [
    {
      symbol: "APPROVAL_TTL_MS",
      importer: "src/acceptance/SP-6_3_AC-2.test.ts",
    },
  ] satisfies RetiredSymbolViolation[]);
});

test("the same importing file listed in footprintPaths is exempt", () => {
  const importer = "src/acceptance/SP-6_3_AC-2.test.ts";
  const repoFiles: RepoFile[] = [
    {
      path: importer,
      content: `import { APPROVAL_TTL_MS } from "../services/approvalToken";\n`,
    },
  ];

  const violations = findUncoveredImporters({
    retiredSymbols: ["APPROVAL_TTL_MS"],
    footprintPaths: ["src/services/approvalToken.ts", importer], // now the importer IS footprinted
    repoFiles,
  });

  assert.deepEqual(violations, []);
});

test("a file that only declares a local const of the same name (no import) is not a violation", () => {
  const repoFiles: RepoFile[] = [
    {
      path: "src/other/localShadow.ts",
      content: [
        "// No import of the retired export — just a coincidental local binding.",
        `const APPROVAL_TTL_MS = 60_000;`,
        "export function ttl() { return APPROVAL_TTL_MS; }",
        "",
      ].join("\n"),
    },
  ];

  const violations = findUncoveredImporters({
    retiredSymbols: ["APPROVAL_TTL_MS"],
    footprintPaths: [], // even with nothing footprinted, a bare local decl must not match
    repoFiles,
  });

  assert.deepEqual(violations, []);
});

test("an empty retiredSymbols set yields no violations without scanning any file", () => {
  // Prove the short-circuit: if the core scanned this file it would read `.content` and throw.
  const landmine: RepoFile = {
    path: "src/would/have/matched.ts",
    get content(): string {
      throw new Error(
        "scanned a file despite empty retiredSymbols (no short-circuit)",
      );
    },
  };

  const violations = findUncoveredImporters({
    retiredSymbols: [],
    footprintPaths: [],
    repoFiles: [landmine],
  });

  assert.deepEqual(violations, []);
});
