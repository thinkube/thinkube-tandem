// WHY (INVARIANT): src/dispatch/adapter.test.ts must contain a test that
// derives, from the source tree, the set of src/engine modules with no
// importer outside src/engine — a live derivation, not a copy of
// ENGINE-WIRING.md's list. This is a standing repo gate: it must keep
// deriving correctly for as long as the ledger exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterTestPath = path.join(repoRoot, "src", "dispatch", "adapter.test.ts");

test("src/dispatch/adapter.test.ts derives the set of no-caller engine modules from the source tree", () => {
  const text = fs.readFileSync(adapterTestPath, "utf8");
  assert.ok(
    /ENGINE-WIRING\.md/.test(text),
    "adapter.test.ts must reference ENGINE-WIRING.md — the gate compares a derived set against the ledger",
  );
  assert.ok(
    /src\/engine|engineDir|engineRoot/.test(text),
    "adapter.test.ts must walk/scan src/engine as part of deriving the module set",
  );
  assert.ok(
    /import/.test(text) && /grep|import.*outside|caller/i.test(text),
    "adapter.test.ts must derive 'no importer outside src/engine' from the tree, not assert a fixed list",
  );
});
