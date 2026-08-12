// WHY (INVARIANT): ENGINE-WIRING.md must state an explicit, written rule for
// what "no product caller" means — precise enough that a reader can
// mechanically reapply it against the current source tree (e.g. "grep for
// imports of it outside src/engine returns zero matches") and reproduce the
// same module list. A ledger without a stated rule is unreproducible by
// construction, so this must keep holding as the file evolves.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoRoot, "ENGINE-WIRING.md");

test("ENGINE-WIRING.md states an explicit, mechanically-reapplicable rule for 'product caller'", () => {
  const text = fs.readFileSync(ledgerPath, "utf8");
  assert.ok(
    /product caller/i.test(text),
    "ENGINE-WIRING.md must use the term 'product caller' to define its own scope",
  );
  assert.ok(
    /grep/i.test(text) && /src\/engine/.test(text),
    "the rule must name a mechanical procedure (e.g. grep across src/ outside src/engine) a reader can rerun",
  );
  assert.ok(
    /import/i.test(text),
    "the rule must be stated in terms of imports, so 'no product caller' has one unambiguous meaning",
  );
});
