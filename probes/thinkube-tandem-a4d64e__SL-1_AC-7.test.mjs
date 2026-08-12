// WHY (TRANSITION): dispatch.test.ts and multiscope.test.ts predate the
// per-cut docs default; every one of their cuts that lands no docs/ path
// must now either carry a waiver with a reason, or the test must assert the
// docs-obligation line explicitly instead of an empty undelivered list —
// proves the retrofit happened, not a behaviour that holds forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

test("every dispatch test whose cut lands no docs/ path waives documentation or asserts the docs line", () => {
  const dispatchSrc = read("src/run/dispatch.test.ts");
  const multiscopeSrc = read("src/run/multiscope.test.ts");
  // Every cut object literal that is NOT the dedicated docs-gate test must
  // either declare a waiver (`docs:` on the cut) or the surrounding test
  // must assert on "docs obligation unmet" explicitly (the docs-gate test
  // itself proves the negative-space case).
  const hasWaiver = (src) => /docs:\s*\{\s*waived:\s*true/.test(src);
  const assertsDocsLine = (src) => src.includes("docs obligation unmet");
  assert.ok(
    hasWaiver(dispatchSrc) || assertsDocsLine(dispatchSrc),
    "dispatch.test.ts's non-docs cuts are retrofitted: either waived with a reason, or the docs line is asserted",
  );
  assert.ok(
    hasWaiver(multiscopeSrc) || assertsDocsLine(multiscopeSrc),
    "multiscope.test.ts's cuts are retrofitted: either waived with a reason, or the docs line is asserted",
  );
});
