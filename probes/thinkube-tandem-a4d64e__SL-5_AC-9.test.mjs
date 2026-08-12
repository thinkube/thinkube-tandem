// WHY (TRANSITION): with ENGINE-WIRING.md written as node 0 of this slice
// and no other tree change, `npm test` must pass — the new gate must not
// break the suite on the very tree it was written for. Its job is done once
// the gate lands green; it stays as a smoke check that the compiled suite
// still runs end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("npm test passes on the tree with ENGINE-WIRING.md present", () => {
  let output;
  let failed = false;
  try {
    output = execFileSync("npm", ["test"], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    failed = true;
    output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
  }
  assert.equal(failed, false, `npm test must pass with ENGINE-WIRING.md in place:\n${output}`);
});
