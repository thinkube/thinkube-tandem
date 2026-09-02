/**
 * A check that never reported a test result did not judge the code.
 *
 * The gate read every non-zero exit as a verdict against the work, so a
 * runner missing one database setting turned twenty-four backend checks
 * red at once, and the report accused code nothing had run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNeverStarted, runAcVerifications } from "../engine/core/closingGate";

test("a collection error is not a failure of the work", async () => {
  const [r] = await runAcVerifications(
    [{ ac: 1, run: "pytest tests/tasks_AC-1_test.py", env: "local" }],
    "/nowhere",
    async () => ({
      code: 4,
      output: "ImportError while loading conftest\nE   Field required [type=missing, input_value={'POSTGRES_HOST': 'x'}]",
    }),
  );
  assert.equal(r.pass, false);
  assert.equal(r.unrunnable, true, "nothing was judged: the check could not start");
  assert.match(r.evidence, /could not start/);
});

test("a check that ran and failed is still the honest red", async () => {
  const [r] = await runAcVerifications(
    [{ ac: 1, run: "pytest tests/tasks_AC-1_test.py", env: "local" }],
    "/nowhere",
    async () => ({ code: 1, output: "FAILED tests/tasks_AC-1_test.py::test_order - AssertionError\n1 failed in 0.4s" }),
  );
  assert.equal(r.unrunnable, undefined);
});

test("the marker reads every runner's way of saying a test ran", () => {
  for (const out of ["1 passed in 0.1s", "not ok 1 - x", "--- FAIL: TestX", "Tests: 3 failed"])
    assert.equal(checkNeverStarted(1, out), false, out);
  assert.equal(checkNeverStarted(4, "E   Field required"), true);
  assert.equal(checkNeverStarted(0, ""), false);
});

test("a product module the check cannot import is the code not being there — a red, not an environment", () => {
  assert.equal(checkNeverStarted(1, "Error: Cannot find module '../out/greet.js'\nimported from probes/a_AC-1.test.mjs"), false);
});
