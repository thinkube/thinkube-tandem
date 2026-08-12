// AC-5 (INVARIANT): the once-only TEP-threading fix must live entirely in
// src/run/dispatch.ts (what it passes into buildWorkerPrompt), never by
// editing engine sources — so the engine-hash gate (which fails any
// src/engine/*.ts change not accompanied by an ENGINE-CHANGE.md marker)
// stays green. This is a standing guard: it must hold for every future
// change to this behaviour too, not just this one ship.
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

test("no file under src/engine/ is modified — the engine-hash gate stays green", () => {
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
      `engine sources changed without ENGINE-CHANGE.md: ${changed.join(", ")}`,
    );
  } else {
    assert.deepEqual(changed, [], "no engine source drifted from the baseline hash");
  }
});
