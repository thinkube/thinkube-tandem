// WHY (INVARIANT): the engine-hash gate must still pass with no
// ENGINE-CHANGE.md present after the docblock correction, because
// importSmoke.test.ts is in the gate's exempt set (the `mine` set the gate
// itself excludes from hashing). Must keep holding: if importSmoke.test.ts
// were ever removed from that exempt set, editing its docblock would start
// demanding an ENGINE-CHANGE.md marker it does not need.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterTestPath = path.join(repoRoot, "src", "dispatch", "adapter.test.ts");

test("importSmoke.test.ts stays in the engine-hash gate's exempt set, so its docblock edit needs no ENGINE-CHANGE.md", () => {
  assert.ok(
    !fs.existsSync(path.join(repoRoot, "ENGINE-CHANGE.md")),
    "no ENGINE-CHANGE.md should be required for a docblock-only edit to importSmoke.test.ts",
  );
  const adapterTestText = fs.readFileSync(adapterTestPath, "utf8");
  assert.match(
    adapterTestText,
    /["']importSmoke\.test\.ts["']/,
    "the engine-hash gate's exempt set must still name importSmoke.test.ts",
  );
});
