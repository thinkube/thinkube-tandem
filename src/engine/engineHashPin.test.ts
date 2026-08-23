/**
 * The engine-hash pin, proved against the files it pins.
 *
 * `src/engine/engine-hash.json` records the SHA-256 of each engine module's
 * bytes, so the engine-hash gate can tell an edited engine file from an
 * untouched one. A pin copied by hand goes stale the moment its file is
 * edited, and the gate then trips on a change that was already recorded and
 * intended — reporting a difference where the delivery says there is none.
 *
 * This test recomputes every pin from the tree and names each file whose
 * recorded hash no longer matches, together with the hash the file actually
 * has now, so a stale pin is corrected from the check's own words instead of
 * being rehashed by hand outside the repository.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";

/** This test runs from the compiled `out-test/` tree, so a read of authored
 *  source resolves against the repository, never against this module's dir. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PIN_PATH = path.join(REPO_ROOT, "src", "engine", "engine-hash.json");

test("engine-hash.json pins the current bytes of every engine file it lists", () => {
  const pins: Record<string, string> = JSON.parse(readFileSync(PIN_PATH, "utf8"));

  const missing: string[] = [];
  const stale: string[] = [];
  for (const [rel, recorded] of Object.entries(pins)) {
    const abs = path.join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(abs)).digest("hex");
    if (actual !== recorded) stale.push(`${rel}\n    recorded ${recorded}\n    actual   ${actual}`);
  }

  assert.deepEqual(
    missing,
    [],
    `engine-hash.json pins files that are not in the tree:\n  ${missing.join("\n  ")}`,
  );
  assert.deepEqual(
    stale,
    [],
    `engine-hash.json is stale — these pins do not match the bytes on disk:\n  ${stale.join("\n  ")}`,
  );
});
