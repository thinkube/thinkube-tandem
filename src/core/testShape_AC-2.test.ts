/**
 * INVARIANT — a check whose name carries `_AC-1` and sits beside the
 * module it drives is held-out evidence, never a unit test the code
 * author may fold into its footprint. This must hold once the gate reads
 * its "is this a test" answer from `src/core/testShape.ts`'s one rule
 * instead of keeping a private, narrower guess (today's private rule only
 * recognises `src/acceptance/`, not a co-located `_AC-` name).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUncoveredTests } from "../engine/testImpactFootprint";

test("a co-located check named with _AC-1 is kind held-out", () => {
  const violations = findUncoveredTests({
    changedFiles: ["src/core/widget.ts"],
    footprintPaths: [],
    repoFiles: [
      {
        path: "src/core/widget_AC-1.test.ts",
        content: `import { build } from "./widget";\n`,
      },
    ],
  });

  assert.equal(violations.length, 1, "the co-located _AC-1 check is caught");
  assert.equal(violations[0].kind, "held-out", "a name carrying _AC-1 is held-out evidence, not a unit test");
});
