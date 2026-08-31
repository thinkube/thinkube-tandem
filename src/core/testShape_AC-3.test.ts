/**
 * INVARIANT — a plain `.test.ts` file sitting next to the changed source
 * it imports is kind `unit`: it is the code author's to fold into the
 * slice's footprint, not held-out evidence. This must keep holding once
 * the gate stops keeping its own private answer and reads the shared
 * rule in `src/core/testShape.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUncoveredTests } from "../engine/testImpactFootprint";

test("a plain .test.ts file beside the changed source it imports is kind unit", () => {
  const violations = findUncoveredTests({
    changedFiles: ["src/core/widget.ts"],
    footprintPaths: [],
    repoFiles: [
      {
        path: "src/core/widget.test.ts",
        content: `import { build } from "./widget";\n`,
      },
    ],
  });

  assert.equal(violations.length, 1, "the plain .test.ts file is caught");
  assert.equal(violations[0].kind, "unit", "a plain co-located .test.ts file is a unit test, not held-out");
});
