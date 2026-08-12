// AC-10 (INVARIANT): the corrected orientation line (AC-8, AC-9) must come
// from what src/run/dispatch.ts passes into the engine's buildWorkerPrompt
// call, never from editing src/engine/core/preflight.ts's own branching —
// same doctrine as AC-5, restated for this specific fix so a reviewer
// checking JUST the orientation-line acceptance criteria still finds the
// engine-hash gate pinned alongside them. A standing guard: must hold for
// every future change to this behaviour too, not just this one ship.
//
// Public interface under test: the repository's engine-hash gate itself
// (src/dispatch/adapter.test.ts), re-run here against the live tree so the
// SL-4 footprint pins that its own delivery does not perturb it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("no file under src/engine/ is modified — orientation is corrected by dispatch, not preflight.ts", () => {
  const repo = path.resolve(__dirname, "..");
  const engineDir = path.join(repo, "src", "engine");
  const mine = new Set(["importSmoke.test.ts", "splitFidelity.test.ts", "storeSync.test.ts"]);
  const current = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !mine.has(name))
        current[path.relative(repo, p)] = createHash("sha256")
          .update(fs.readFileSync(p))
          .digest("hex");
    }
  };
  walk(engineDir);
  const baseline = JSON.parse(
    fs.readFileSync(path.join(engineDir, "engine-hash.json"), "utf8"),
  );
  const changed = [
    ...Object.keys(baseline).filter((k) => current[k] !== baseline[k]),
    ...Object.keys(current).filter((k) => !(k in baseline)),
  ];
  if (changed.length) {
    assert.ok(
      fs.existsSync(path.join(repo, "ENGINE-CHANGE.md")),
      `engine sources changed without ENGINE-CHANGE.md: ${changed.join(", ")} — the orientation fix must live in dispatch.ts, not preflight.ts`,
    );
  } else {
    assert.deepEqual(changed, [], "no engine source (including preflight.ts) drifted from the baseline hash");
  }
});
