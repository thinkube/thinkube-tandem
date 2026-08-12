// WHY (INVARIANT): the engine-hash gate must still pass with no
// ENGINE-CHANGE.md present — adding the wiring gate to adapter.test.ts must
// touch no file under src/engine that the hash baseline covers. This must
// keep holding: a future edit that accidentally modifies an engine source
// file to support the wiring gate (instead of adapter.test.ts alone) would
// silently require ENGINE-CHANGE.md and this test catches that regression.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(repoRoot, "src", "engine");
const baselinePath = path.join(engineDir, "engine-hash.json");

test("the engine-hash baseline still matches src/engine with no ENGINE-CHANGE.md present", () => {
  assert.ok(
    !fs.existsSync(path.join(repoRoot, "ENGINE-CHANGE.md")),
    "this slice must not require an ENGINE-CHANGE.md marker",
  );

  const mine = new Set(["importSmoke.test.ts", "splitFidelity.test.ts", "storeSync.test.ts"]);
  const current = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !mine.has(name))
        current[path.relative(repoRoot, p)] = createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(engineDir);

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const changed = [
    ...Object.keys(baseline).filter((k) => current[k] !== baseline[k]),
    ...Object.keys(current).filter((k) => !(k in baseline)),
  ];
  assert.deepEqual(changed, [], `no file under src/engine covered by the baseline may change: ${changed.join(", ")}`);
});
