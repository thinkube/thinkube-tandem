/**
 * Unit tests for `findUncoveredTests` + `buildTestImpactRefusal` (SP-6/18, TEP-6) — the pure,
 * injectable author-time test-impact gate that refuses a slice whose change's test blast-radius
 * isn't in scope. node:test + node:assert; run via the repo's self-verify.
 *
 * The core is a total function over `{ changedFiles, footprintPaths, repoFiles }` (files injected as
 * path→content, never read from disk). These tests pin the behaviours the Spec's contract requires,
 * using synthetic file maps only — no disk, no board, no model:
 *
 *   1. unit vs held-out   — a `.test.ts` importer is `kind: "unit"`; an importer under
 *                           `src/acceptance/` is `kind: "held-out"`.
 *   2. import-vs-not      — a test that DOES import a changed file is a violation; one that imports
 *                           a DIFFERENT file (or nothing) is not.
 *   3. footprint exemption— the same importing test, once listed in `footprintPaths`, is exempt.
 *   4. relative resolution— `./` and `../` specifiers resolve lexically against the test's dir, and a
 *                           bare package specifier never matches.
 *   5. short-circuit      — empty `changedFiles` yields `[]` without scanning any file.
 *   6. refusal tokens     — the `unit` line contains `footprint`; the `held-out` line contains
 *                           `retire` and NO `footprint`; the whole message is flush-left/trimmed;
 *                           empty ⇒ "".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findUncoveredTests,
  buildTestImpactRefusal,
  type RepoFile,
  type TestImpactViolation,
} from "./testImpactFootprint";

test("a unit test importing a changed source file is a `unit` violation", () => {
  const repoFiles: RepoFile[] = [
    {
      path: "src/services/foo.test.ts",
      content: `import { foo } from "./foo";\nfoo();\n`,
    },
  ];
  const violations = findUncoveredTests({
    changedFiles: ["src/services/foo.ts"],
    footprintPaths: ["src/services/foo.ts"], // the changed file is footprinted; its test is NOT
    repoFiles,
  });
  assert.deepEqual(violations, [
    {
      test: "src/services/foo.test.ts",
      changed: "src/services/foo.ts",
      kind: "unit",
    },
  ] satisfies TestImpactViolation[]);
});

test("a held-out acceptance probe importing a changed source file is a `held-out` violation", () => {
  const repoFiles: RepoFile[] = [
    {
      path: "src/acceptance/SP-6_18_AC-1.test.ts",
      content: `import { foo } from "../services/foo";\n`,
    },
  ];
  const violations = findUncoveredTests({
    changedFiles: ["src/services/foo.ts"],
    footprintPaths: ["src/services/foo.ts"],
    repoFiles,
  });
  assert.deepEqual(violations, [
    {
      test: "src/acceptance/SP-6_18_AC-1.test.ts",
      changed: "src/services/foo.ts",
      kind: "held-out",
    },
  ] satisfies TestImpactViolation[]);
});

test("a test that imports a DIFFERENT file (or nothing) is not a violation", () => {
  const repoFiles: RepoFile[] = [
    {
      path: "src/services/bar.test.ts",
      content: `import { bar } from "./bar";\n`, // imports bar, not the changed foo
    },
    {
      path: "src/services/noimports.test.ts",
      content: `const x = 1;\nexport { x };\n`, // imports nothing
    },
  ];
  const violations = findUncoveredTests({
    changedFiles: ["src/services/foo.ts"],
    footprintPaths: [],
    repoFiles,
  });
  assert.deepEqual(violations, []);
});

test("the same importing test listed in footprintPaths is exempt", () => {
  const testFile = "src/services/foo.test.ts";
  const repoFiles: RepoFile[] = [
    { path: testFile, content: `import { foo } from "./foo";\n` },
  ];
  const violations = findUncoveredTests({
    changedFiles: ["src/services/foo.ts"],
    footprintPaths: ["src/services/foo.ts", testFile], // the test IS footprinted now
    repoFiles,
  });
  assert.deepEqual(violations, []);
});

test("relative `../` specifiers resolve lexically; bare package specifiers never match", () => {
  const repoFiles: RepoFile[] = [
    {
      path: "src/acceptance/SP-6_18_AC-1.test.ts",
      // `../services/foo` → src/services/foo.ts (a changed file → violation)
      // `vscode`          → bare package, never a repo file → no violation
      content: [
        `import { foo } from "../services/foo";`,
        `import * as vscode from "vscode";`,
        "",
      ].join("\n"),
    },
    {
      path: "src/other/wrong.test.ts",
      // `../services/foo` from src/other resolves to the same changed file
      content: `import "../services/foo";\n`,
    },
  ];
  const violations = findUncoveredTests({
    changedFiles: ["src/services/foo.ts"],
    footprintPaths: [],
    repoFiles,
  });
  assert.deepEqual(violations, [
    {
      test: "src/acceptance/SP-6_18_AC-1.test.ts",
      changed: "src/services/foo.ts",
      kind: "held-out",
    },
    {
      test: "src/other/wrong.test.ts",
      changed: "src/services/foo.ts",
      kind: "unit",
    },
  ] satisfies TestImpactViolation[]);
});

test("empty changedFiles yields no violations without scanning any file", () => {
  // Prove the short-circuit: if the core scanned this file it would read `.content` and throw.
  const landmine: RepoFile = {
    path: "src/services/foo.test.ts",
    get content(): string {
      throw new Error(
        "scanned a file despite empty changedFiles (no short-circuit)",
      );
    },
  };
  const violations = findUncoveredTests({
    changedFiles: [],
    footprintPaths: [],
    repoFiles: [landmine],
  });
  assert.deepEqual(violations, []);
});

test("buildTestImpactRefusal: unit line carries `footprint`; held-out line carries `retire` and NO `footprint`", () => {
  const message = buildTestImpactRefusal([
    {
      test: "src/services/foo.test.ts",
      changed: "src/services/foo.ts",
      kind: "unit",
    },
    {
      test: "src/acceptance/SP-6_18_AC-1.test.ts",
      changed: "src/services/foo.ts",
      kind: "held-out",
    },
  ]);
  const lines = message.split("\n");
  assert.equal(lines.length, 2, "one line per violation");

  const unitLine = lines[0];
  assert.match(
    unitLine,
    /footprint/,
    "unit line adds the test to the footprint",
  );

  const heldLine = lines[1];
  assert.match(heldLine, /retire/, "held-out line directs to retire");
  assert.doesNotMatch(
    heldLine,
    /footprint/,
    "held-out line never mentions footprint (a probe is never footprinted)",
  );

  // Flush-left / trimmed: no leading or trailing whitespace on the whole message.
  assert.equal(message, message.trim());
  assert.equal(message.startsWith(" "), false);
  assert.equal(message.endsWith("\n"), false);
});

test("buildTestImpactRefusal: an empty violation set is the empty string", () => {
  assert.equal(buildTestImpactRefusal([]), "");
});
