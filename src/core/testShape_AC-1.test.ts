/**
 * INVARIANT — the import-impact gate must catch a test under a
 * `__tests__/` directory that imports a changed source file, because that
 * is the shape `src/core/testShape.ts`'s one rule already recognises;
 * once the gate reads that rule instead of its own private guess, this
 * directory shape must be caught like any other test-shaped path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUncoveredTests } from "../engine/testImpactFootprint";

test("a file under __tests__/ that imports a changed source file is reported as a violation", () => {
  const violations = findUncoveredTests({
    changedFiles: ["src/services/foo.ts"],
    footprintPaths: [],
    repoFiles: [
      {
        path: "src/services/__tests__/foo.test.ts",
        content: `import { thing } from "../foo";\n`,
      },
    ],
  });

  assert.equal(violations.length, 1, "the __tests__ file importing the changed source is caught");
  assert.equal(violations[0].test, "src/services/__tests__/foo.test.ts");
  assert.equal(violations[0].changed, "src/services/foo.ts");
});
