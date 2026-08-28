/**
 * What the gate judges the tree by: the tree as it stands when it judges.
 *
 * The gate spends an hour between preparing the tree and ruling on it —
 * every check, every assessment, every review, the finisher's repairs. A
 * reading of the product build taken at the start and applied at the end
 * withheld work that built perfectly well by then: the branch compiled,
 * and the delivery said it did not.
 *
 * The build is still a veto. It is judged fresh, folded into the suite's
 * own output as a named failure, so a repair is seen and a real breakage
 * is not waved through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { suiteVerdictOf } from "./suite";

/** What judgeTree hands to the verdict when the build fails. */
const withBuildFailure = (suiteOutput: string, cmd = "npm run compile"): string =>
  `${suiteOutput}\nnot ok 0 - the product build (${cmd}) does not build as shipped\nTS1005: ';' expected\n`;

test("a tree that does not build is red, named as the product build", () => {
  const v = suiteVerdictOf(1, withBuildFailure("# tests 10\n# pass 10\n# fail 0\n"));
  assert.equal(v.green, false);
  assert.ok(
    v.failures.some((f) => /product build/.test(f.name)),
    `the build failure must be named; got: ${v.failures.map((f) => f.name).join(", ")}`,
  );
});

test("a tree that builds and passes is green — no earlier reading overrides it", () => {
  const v = suiteVerdictOf(0, "TAP version 13\n# tests 10\n# pass 10\n# fail 0\n");
  assert.equal(v.green, true);
  assert.deepEqual(v.failures, []);
});

test("a green build with a red suite is still red", () => {
  const v = suiteVerdictOf(1, "not ok 3 - a standing check\n# tests 10\n# pass 9\n# fail 1\n");
  assert.equal(v.green, false);
  assert.ok(v.failures.some((f) => /standing check/.test(f.name)));
});
