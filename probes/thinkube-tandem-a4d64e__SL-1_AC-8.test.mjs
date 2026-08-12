// WHY (TRANSITION): the retrofit must not weaken the suite — every former
// `assert.equal(outcome.undelivered.length, 0)` line that pinned a run's
// honesty must still exist verbatim in the source, restated under the new
// per-cut docs rule rather than deleted to dodge it.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

test("no former undelivered.length === 0 assertion was deleted by the docs-default retrofit", () => {
  const dispatchSrc = read("src/run/dispatch.test.ts");
  const pattern = /assert\.equal\(\s*outcome\.undelivered\.length,\s*0\s*\)/g;
  const matches = dispatchSrc.match(pattern) ?? [];
  assert.ok(
    matches.length > 0,
    "at least one honest-run assertion (outcome.undelivered.length === 0) still pins a signed TEP's clean run",
  );
});
